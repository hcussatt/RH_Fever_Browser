// The Wii common key is not part of this site: visitors enter the key from their own Wii (or the
// owner's dev host supplies it, devhost.mjs). Only its SHA-256 is here, to catch typos.
const KEY_SHA256='de38aeab4fe0c36d828a47e6fd315100e7ce234d3b00aa25e6ad6f5ff2824af8',STORE='rhf-wii-common-key';
export function readCommonKey(){try{return localStorage.getItem(STORE)||'';}catch{return '';}}
export function rememberCommonKey(key){try{localStorage.setItem(STORE,key);}catch{}}
// An error message, or '' when the text is the retail Wii common key (spaces and 0x allowed).
export const keyDigits=text=>String(text||'').replace(/0x/gi,'').replace(/[\s,:-]/g,'');
export async function checkCommonKey(text){
 const digits=keyDigits(text);
 if(!/^[0-9a-f]{32}$/i.test(digits))return 'Enter the 32 hexadecimal digits of your Wii common key.';
 const bytes=new Uint8Array(digits.match(/../g).map(h=>parseInt(h,16)));
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return hash===KEY_SHA256?'':'That is not the retail Wii common key. Check the digits and try again.';
}
