/**
 * The client a per-client limit or per-day record is keyed on, derived from the connecting address (WS-03). An IPv4
 * address is used as is. An IPv6 address is cut to its /64 network: one subscriber or cloud host controls a whole /64
 * (2^64 addresses), so keying on the full address would give every rotated address a fresh budget. IPv4-mapped IPv6 is
 * treated as IPv4. The result only ever feeds a digest (rate-limit keys, per-day records); it is never stored or logged.
 * Deliberately a leaf module, so moderation.ts and issuer.ts can share it without importing the app.
 */
export const IPV6_PREFIX_GROUPS=4;
function ipv6Groups(address:string):string[]|null {
 let text=address.toLowerCase().split('%')[0]!;
 // An embedded IPv4 tail ("::ffff:198.51.100.7", "64:ff9b::198.51.100.7") becomes two hex groups.
 const tail=/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
 if(tail) {
  const bytes=tail.slice(1).map(Number);if(bytes.some(b=>b>255))return null;
  text=`${text.slice(0,tail.index)}${((bytes[0]!<<8)|bytes[1]!).toString(16)}:${((bytes[2]!<<8)|bytes[3]!).toString(16)}`;
 }
 const halves=text.split('::');if(halves.length>2)return null;
 const head=halves[0]?halves[0].split(':'):[],rest=halves.length===2&&halves[1]?halves[1].split(':'):[];
 const missing=8-head.length-rest.length;
 if(halves.length===1?missing!==0:missing<1)return null;
 const groups=[...head,...Array(halves.length===2?missing:0).fill('0'),...rest];
 return groups.length===8&&groups.every(g=>/^[0-9a-f]{1,4}$/.test(g))?groups.map(g=>g.replace(/^0+(?=.)/,'')):null;
}
/** 'local' when the platform supplied no address (development and tests). */
export function clientAddress(raw:string|null|undefined):string {
 const address=(raw??'').trim();
 if(!address)return 'local';
 if(!address.includes(':'))return address;
 const groups=ipv6Groups(address);
 if(!groups)return address.toLowerCase();
 // ::ffff:a.b.c.d is an IPv4 client.
 if(groups.slice(0,5).every(g=>g==='0')&&groups[5]==='ffff'){const hi=parseInt(groups[6]!,16),lo=parseInt(groups[7]!,16);return `${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`;}
 return `${groups.slice(0,IPV6_PREFIX_GROUPS).join(':')}::/64`;
}
/**
 * Header the main worker adds to every service-binding call when INFERENCE_CALLER_SECRET is set; the inference worker
 * then answers only requests that carry it (WS-09). Kept here so neither worker imports the other.
 */
export const CALLER_HEADER='x-siwt-caller';
/** The client of a request: the /64 (IPv6) or the address (IPv4) behind cf-connecting-ip. */
export const requestClient=(request:Request)=>clientAddress(request.headers.get('cf-connecting-ip'));
/**
 * The wider network of a client, for limits that one person could otherwise multiply by rotating addresses: an IPv4
 * address's /24, an IPv6 address's /48 (the size a tunnel broker or a hosting account usually routes to one customer,
 * who can then use 65,536 different /64s). IPv4-mapped IPv6 counts as IPv4. Like clientAddress, it only ever feeds a
 * digest and is never stored.
 */
export function clientNetwork(raw:string|null|undefined):string {
 const client=clientAddress(raw);
 if(client==='local')return client;
 const v4=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(client);
 if(v4)return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
 const groups=ipv6Groups((raw??'').trim());
 return groups?`${groups.slice(0,3).join(':')}::/48`:client;
}
/** The wider network (clientNetwork) behind cf-connecting-ip. */
export const requestNetwork=(request:Request)=>clientNetwork(request.headers.get('cf-connecting-ip'));
