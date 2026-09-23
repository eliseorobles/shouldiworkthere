// Worker entry module. workerd treats every named export of the entry module as an entrypoint, so only the default
// handler may be exported here; the implementation and its testable helpers live in ./app.ts.
import worker from './app.ts';
export default worker;
