// Inference Worker entry module. Only the default handler may be exported (workerd treats named exports as
// entrypoints); the implementation and its testable helpers live in ./inference-core.ts.
import worker from './inference-core.ts';
export default worker;
