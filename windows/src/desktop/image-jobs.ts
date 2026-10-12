import path from 'node:path';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { CropRect } from '../shared/model/BlackBorders';
let worker: Worker | undefined, sequence = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function instance(): Worker {
 if (worker) return worker;
 const bundled = path.join(__dirname, 'image-worker.cjs'), unpacked = bundled.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2'), compiled = fs.existsSync(unpacked) ? unpacked : bundled, source = path.join(__dirname, 'image-worker.ts');
 if (!fs.existsSync(compiled) && !fs.existsSync(source)) throw new Error('图片处理组件缺失，请重新安装');
 worker = fs.existsSync(compiled) ? new Worker(compiled) : new Worker("require('tsx/cjs'); require(require('node:worker_threads').workerData.source);", { eval: true, workerData: { source } });
 const created = worker;
 worker.on('message', message => { const job = pending.get(message.id); if (!job) return; pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(new Error(message.error)) : job.resolve(message.value); if (!pending.size) created.unref(); });
 worker.on('error', error => { if (worker !== created) return; const jobs = Array.from(pending.values()); pending.clear(); worker = undefined; jobs.forEach(job => { clearTimeout(job.timer); job.reject(error); }); });
 worker.on('exit', code => { if (worker === created) { const jobs = Array.from(pending.values()); pending.clear(); worker = undefined; jobs.forEach(job => { clearTimeout(job.timer); job.reject(new Error('图片处理已停止（' + code + '）')); }); } });
 worker.unref();
 return worker;
}
async function job(kind: string, a: ArrayBuffer, b: ArrayBuffer | undefined, width: number, height: number, strideA: number, strideB?: number): Promise<any> {
 if (pending.size >= 64) throw new Error('正在处理其他课件，请稍候');
 const id = ++sequence, active = instance();
 active.ref();
 return new Promise((resolve, reject) => { const timer = setTimeout(() => { void disposeImageJobs(); }, 15000); pending.set(id, { resolve, reject, timer }); try { active.postMessage({ id, kind, a, b, width, height, strideA, strideB }, b ? [a, b] : [a]); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); if (!pending.size) active.unref(); } });
}
export function compareScreenshotsAsync(a: ArrayBuffer, b: ArrayBuffer, width: number, height: number, strideA: number, strideB: number): Promise<boolean> { return job('compare', a, b, width, height, strideA, strideB); }
export function blackBorderRegionAsync(a: ArrayBuffer, width: number, height: number, strideA: number): Promise<CropRect | undefined> { return job('crop', a, undefined, width, height, strideA); }
export async function disposeImageJobs(): Promise<void> { const old = worker; worker = undefined; const jobs = Array.from(pending.values()); pending.clear(); jobs.forEach(job => { clearTimeout(job.timer); job.reject(new Error('图片处理已取消')); }); await old?.terminate(); }
