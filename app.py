
# MIT License

# Copyright (c) 2019 Kelvin Gao

# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:

# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import io
import os
import tornado.ioloop
import tornado.web
import tornado.locks
import tornado.websocket
from tornado.options import define, options

from matplotlib.backends.backend_webagg_core import (
    new_figure_manager_given_figure)
from matplotlib.figure import Figure

import numpy as np
import json

import logging
from utils import createLogger

logger = createLogger(__name__, level=logging.INFO)

define("port", default=5000, help="run on the given port", type=int)


def create_figure():
    """
    Creates a simple example figure.
    """
    fig = Figure()
    a = fig.add_subplot(111)
    t = np.arange(0.0, 3.0, 0.01)
    s = np.sin(2 * np.pi * t)
    a.plot(t, s)

    logger.info('create figure')
    return fig


class Application(tornado.web.Application):
    def __init__(self, figure):
        self.fignum = id(figure)
        self.manager = new_figure_manager_given_figure(self.fignum, figure)
        handlers = [
            (r"/", self.MainHandler),
            (r'/([0-9]+)/ws', self.WebSocket),
            (r'/download.([a-z0-9.]+)', self.Download),
        ]
        settings = dict(
            template_path=os.path.join(os.path.dirname(__file__), "templates"),
            static_path=os.path.join(os.path.dirname(__file__), "static"),
            xsrf_cookies=True,
            cookie_secret="__TODO:_GENERATE_YOUR_OWN_RANDOM_VALUE_HERE__",
            debug=True,
        )
        super(Application, self).__init__(handlers, **settings)

    class MainHandler(tornado.web.RequestHandler):
        def get(self):
            ws_uri = "ws://{req.host}/".format(req=self.request)
            self.render("index.html", ws_uri=ws_uri, fig_id=self.application.manager.num,
                fig_num=self.application.fignum)

    class WebSocket(tornado.websocket.WebSocketHandler):
        """
        A websocket for interactive communication between the plot in
        the browser and the server.

        In addition to the methods required by tornado, it is required to
        have two callback methods:

            - ``send_json(json_content)`` is called by matplotlib when
                it needs to send json to the browser.  `json_content` is
                a JSON tree (Python dictionary), and it is the responsibility
                of this implementation to encode it as a string to send over
                the socket.

            - ``send_binary(blob)`` is called to send binary image data
                to the browser.
        """
        supports_binary = True

        def open(self, fignum):
            # Register the websocket with the FigureManager.
            logger.info('request to open websocket')
            logger.debug(self.request)

            manager = self.application.manager
            manager.add_web_socket(self)
            if hasattr(self, 'set_nodelay'):
                self.set_nodelay(True)
                logger.info(f'opened websocket for Figure {fignum}')

        def on_close(self):
            # When the socket is closed, deregister the websocket with
            # the FigureManager.
            manager = self.application.manager
            manager.remove_web_socket(self)

            logger.warn('websocket closed')

        def on_message(self, message):
            # The 'supports_binary' message is relevant to the
            # websocket itself.  The other messages get passed along
            # to matplotlib as-is.

            # Every message has a "type" and a "figure_id".
            message = json.loads(message)
            if message['type'] == 'supports_binary':
                self.supports_binary = message['value']
            else:
                logger.debug(f'got message { message }')
                manager = self.application.manager
                manager.handle_json(message)

        def send_json(self, content):
            self.write_message(json.dumps(content))

        def send_binary(self, blob):
            if self.supports_binary:
                logger.debug('send binary image data to the browser')
                self.write_message(blob, binary=True)
            else:
                data_uri = "data:image/png;base64,{0}".format(
                    blob.encode('base64').replace('\n', ''))
                self.write_message(data_uri)

    class Download(tornado.web.RequestHandler):
        """
        Handles downloading of the figure in various file formats.
        """

        def get(self, fmt):
            manager = self.application.manager

            mimetypes = {
                'ps': 'application/postscript',
                'eps': 'application/postscript',
                'pdf': 'application/pdf',
                'svg': 'image/svg+xml',
                'png': 'image/png',
                'jpeg': 'image/jpeg',
                'tif': 'image/tiff',
                'emf': 'application/emf'
            }

            self.set_header('Content-Type', mimetypes.get(fmt, 'binary'))

            buff = io.BytesIO()
            manager.canvas.figure.savefig(buff, format=fmt)
            self.write(buff.getvalue())


async def main():
    tornado.options.parse_command_line()

    figure = create_figure()
    app = Application(figure)

    app.listen(options.port)

    logger.info(f"http://127.0.0.1:{options.port}/")
    logger.info("Press Ctrl+C to quit")

    # In this demo the server will simply run until interrupted
    # with Ctrl-C, but if you want to shut down more gracefully,
    # call shutdown_event.set().
    shutdown_event = tornado.locks.Event()
    await shutdown_event.wait()


if __name__ == "__main__":
    tornado.ioloop.IOLoop.current().run_sync(main)
