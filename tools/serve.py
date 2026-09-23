# Dev server for the game folder with caching disabled (so edited ES modules always reload).
import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(NoCache, directory=ROOT)).serve_forever()
