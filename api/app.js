import { Readable } from 'node:stream';
import handler from '../server.mjs';

export default {
  async fetch(request) {
    const req = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
    req.url = request.url;
    req.method = request.method;
    req.headers = Object.fromEntries(request.headers);
    const headers = new Headers();
    let output = '';
    const res = {
      statusCode: 200,
      setHeader(key, value) { headers.set(key, value); },
      end(value) { output = value; }
    };
    await handler(req, res);
    return new Response(output, { status: res.statusCode, headers });
  }
};
