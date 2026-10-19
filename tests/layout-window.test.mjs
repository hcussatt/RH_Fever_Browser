import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowPixels} from '../web/engine/layout-window.mjs';

test('one-frame windows mirror corners and clamp edges without joining quads',()=>{
 const corner={width:2,height:2,data:new Uint8ClampedArray([0,0,0,0, 90,90,90,255, 120,120,120,255, 255,255,255,255])};
 const width=9,height=7,out=windowPixels(corner,width,height,[255,255,255,255]);
 const pixel=(x,y)=>[...out.subarray((y*width+x)*4,(y*width+x)*4+4)];
 assert.deepEqual(pixel(0,0),[0,0,0,0]);
 assert.deepEqual(pixel(1,0),pixel(7,0));
 assert.deepEqual(pixel(0,1),pixel(8,5));
 for(let x=2;x<7;x++)assert.deepEqual(pixel(x,0),[90,90,90,255]);
 for(let y=2;y<5;y++)assert.deepEqual(pixel(0,y),[120,120,120,255]);
 for(let y=1;y<6;y++)for(let x=1;x<8;x++)assert.equal(pixel(x,y)[3],255);
});

test('transparent window interiors and partially transparent corners stay transparent',()=>{
 const corner={width:1,height:1,data:new Uint8ClampedArray([255,255,255,128])};
 const out=windowPixels(corner,5,5,[20,40,60,0]);
 assert.deepEqual([...out.subarray(0,4)],[255,255,255,128]);
 assert.deepEqual([...out.subarray(48,52)],[20,40,60,0]);
});

test('small windows crop symmetrically when their corners overlap',()=>{
 const corner={width:2,height:2,data:new Uint8ClampedArray([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255])};
 const out=windowPixels(corner,3,3,[0,0,0,0]);
 assert.deepEqual([...out.subarray(0,4)],[...out.subarray(32,36)]);
 assert.equal(out[19],255);
});
