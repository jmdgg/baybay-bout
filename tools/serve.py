# Dev server: `python -m http.server`, but it tells the browser to revalidate every file,
# so edited JS modules and data files show up on a normal reload instead of stale cached copies.
# usage: python tools/serve.py [port]   (run from the project root)
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
