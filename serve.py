"""Serve this standalone package; verify its manifest before startup."""
import argparse,hashlib,json
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer

root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=8090)
parser.add_argument('--verify-only',action='store_true')
parser.add_argument('--open-browser',action='store_true')
args=parser.parse_args()
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for item in manifest['files']:
    path=(root/item['path']).resolve()
    if not path.is_relative_to(root):raise ValueError('Invalid manifest path')
    data=path.read_bytes()
    if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:
        raise ValueError('Package file changed: '+item['path'])
print('Package integrity verified',flush=True)
if args.verify_only:raise SystemExit(0)
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.gz':'application/gzip'}
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
print(f'Gamma player: http://127.0.0.1:{args.port}/',flush=True)
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
if args.open_browser:
    import webbrowser
    webbrowser.open(f'http://127.0.0.1:{args.port}/')
server.serve_forever()
