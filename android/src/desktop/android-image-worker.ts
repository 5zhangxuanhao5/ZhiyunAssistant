import { screenshotsEqual } from '../shared/model/SlideSimilarity';
import { blackBorderRegion } from '../shared/model/BlackBorders';
self.onmessage = event => { const job = event.data; try { const value = job.kind === 'compare' ? screenshotsEqual(new Uint8Array(job.a), new Uint8Array(job.b), job.width, job.height, job.strideA, job.strideB) : blackBorderRegion(new Uint8Array(job.a), job.width, job.height, job.strideA); self.postMessage({ id: job.id, value }); } catch (error) { self.postMessage({ id: job.id, error: (error as Error).message }); } };
