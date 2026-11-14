/**
 * Niimbot label printers (D110 & co.) over Web Bluetooth, via niimbluelib.
 * Works in Chrome/Edge (desktop and Android). The Home Assistant app's WebView
 * has no Web Bluetooth, there the label dialog offers "open in browser".
 */
import { NiimbotBluetoothClient, ImageEncoder, LabelType } from '@mmote/niimbluelib'

let client: NiimbotBluetoothClient | null = null

export type PrinterState = {
  connected: boolean
  model?: string
  printheadPixels: number
  densityMin: number
  densityMax: number
  densityDefault: number
  labelsLeft?: number
}

const DEFAULT_STATE: PrinterState = { connected: false, printheadPixels: 96, densityMin: 1, densityMax: 3, densityDefault: 2 }

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function printerState(): PrinterState {
  if (!client || !client.isConnected()) return { ...DEFAULT_STATE }
  const meta = client.getModelMetadata()
  const rfid = client.getRfidInfo()?.labelRfidInfo
  const left = rfid && rfid.tagPresent && rfid.allPaper > 0 ? Math.max(0, rfid.allPaper - rfid.usedPaper) : undefined
  return {
    connected: true,
    model: meta?.model,
    printheadPixels: meta?.printheadPixels ?? DEFAULT_STATE.printheadPixels,
    densityMin: meta?.densityMin ?? DEFAULT_STATE.densityMin,
    densityMax: meta?.densityMax ?? DEFAULT_STATE.densityMax,
    densityDefault: meta?.densityDefault ?? DEFAULT_STATE.densityDefault,
    labelsLeft: left,
  }
}

export async function connectPrinter(): Promise<PrinterState> {
  if (client?.isConnected()) return printerState()
  client = new NiimbotBluetoothClient()
  await client.connect()
  try { await client.fetchRfidInfo() } catch { /* not every roll has a tag */ }
  return printerState()
}

export async function disconnectPrinter(): Promise<void> {
  try { await client?.disconnect() } finally { client = null }
}

/** Print the canvases (one label each). onProgress gets the number of finished labels. */
export async function printCanvases(canvases: HTMLCanvasElement[], density: number,
                                    onProgress?: (done: number) => void): Promise<void> {
  if (!client || !client.isConnected()) throw new Error('not connected')
  const meta = client.getModelMetadata()
  const taskName = client.getPrintTaskType() ?? 'D110'
  const direction = meta?.printDirection ?? 'left'
  const task = client.protocol.newPrintTask(taskName, {
    totalPages: canvases.length, density, labelType: LabelType.WithGaps,
  })
  try {
    await task.printInit()
    for (let i = 0; i < canvases.length; i++) {
      // PageColorType.SingleColor = 0 (black on white)
      await task.printPage(ImageEncoder.encodeCanvas(canvases[i], 0, direction), 1)
      await task.waitForPageFinished()
      onProgress?.(i + 1)
    }
    await task.waitForFinished()
  } finally {
    await client.protocol.printEnd()
  }
  try { await client.fetchRfidInfo() } catch { /* ignore */ }
}
