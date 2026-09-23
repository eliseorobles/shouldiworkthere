/** An unbiased integer in [0, upper). Mask to a power-of-two range and reject the unused tail. */
export function randomInt(upper:number):number {
  if(!Number.isSafeInteger(upper)||upper<1||upper>0x80000000)throw new RangeError('upper must be an integer from 1 to 2^31');
  const mask=2**Math.ceil(Math.log2(upper))-1;
  const word=new Uint32Array(1);
  let value:number;
  do {crypto.getRandomValues(word);value=word[0]!&mask;} while(value>=upper);
  return value;
}
