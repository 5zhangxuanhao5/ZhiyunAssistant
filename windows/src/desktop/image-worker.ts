import { parentPort } from 'node:worker_threads';
import { screenshotsEqual } from '../shared/model/SlideSimilarity';
import { blackBorderRegion } from '../shared/model/BlackBorders';
parentPort?.on('message', (job: { id: number; kind: string; a: ArrayBuffer; b?: ArrayBuffer; width: number; height: number; strideA: number; strideB?: number }) => {
 try { const value = job.kind === 'compare' ? screenshotsEqual(new Uint8Array(job.a), new Uint8Array(job.b!), job.width, job.height, job.strideA, job.strideB!) : blackBorderRegion(new Uint8Array(job.a), job.width, job.height, job.strideA); parentPort!.postMessage({ id: job.id, value }); }
 catch (error) { parentPort!.postMessage({ id: job.id, error: (error as Error).message }); }
});
