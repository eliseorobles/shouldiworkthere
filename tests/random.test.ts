import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from '../shared/random.ts';

test('random integers reject the unused tail rather than folding it onto lower values',()=>{
  const draws=[0xffffffff,900000,899999];
  const rng=mock.method(crypto,'getRandomValues',(word:Uint32Array)=>{assert.ok(draws.length);word[0]=draws.shift()!;return word;});
  try {assert.equal(randomInt(900000),899999);assert.equal(rng.mock.callCount(),3);}
  finally {rng.mock.restore();}
});

test('power-of-two ranges retain both endpoints and do not create signed negative results',()=>{
  const draws=[0,0xffffffff,0xffffffff];
  const rng=mock.method(crypto,'getRandomValues',(word:Uint32Array)=>{word[0]=draws.shift()!;return word;});
  try {assert.equal(randomInt(16),0);assert.equal(randomInt(16),15);assert.equal(randomInt(0x80000000),0x7fffffff);}
  finally {rng.mock.restore();}
});

test('invalid random ranges fail before drawing randomness; the singleton range always returns zero',()=>{
  const rng=mock.method(crypto,'getRandomValues',(word:Uint32Array)=>{word[0]=0xffffffff;return word;});
  try {
    for(const upper of [0,-1,1.5,NaN,Infinity,0x80000001])assert.throws(()=>randomInt(upper),RangeError);
    assert.equal(rng.mock.callCount(),0);
    assert.equal(randomInt(1),0);
  } finally {rng.mock.restore();}
});
