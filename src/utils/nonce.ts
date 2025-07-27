// @ts-ignore
declare var global: any;
export default function (length: number = 15): string {
  const now = Math.pow(10, 2) * +new Date();

  if (now == global["trompot-last-nonce-id"]) {
    global["trompot-last-nonce-repeat"] = (global["trompot-last-nonce-repeat"] || 0) + 1;
  } else {
    global["trompot-last-nonce-id"] = now;
    global["trompot-last-nonce-repeat"] = 0;
  }

  const s = (now + (global["trompot-last-nonce-repeat"] || 0)).toString();

  return s.substr(s.length - length);
}
