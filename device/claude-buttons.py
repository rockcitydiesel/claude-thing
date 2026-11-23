#!/usr/bin/env python3
"""Forward Car Thing knob/button presses to the Claude Thing server on the laptop.

Reads evdev events (the kiosk's own button handler also reads them; evdev
allows several readers) and POSTs {"key": K} to http://192.168.7.1:7777/input.
Python 3.9 stdlib only.

>>> translate(1, 2, 1), translate(1, 3, 1), translate(1, 4, 1), translate(1, 5, 1)
('1', '2', '3', '4')
>>> translate(1, 50, 1), translate(1, 28, 1), translate(1, 1, 1)
('m', 'ENTER', 'ESC')
>>> translate(2, 6, 1), translate(2, 6, 4294967295), translate(2, 6, -1)
('RIGHT', 'LEFT', 'LEFT')
>>> translate(1, 2, 0) is None   # key release
True
>>> translate(1, 99, 1) is None  # unmapped key
True
"""
import json
import struct
import sys
import threading
import time
import urllib.request

URL = 'http://192.168.7.1:7777/input'
EVENT_FORMAT = 'llHHI'
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)
DEVICES = ['/dev/input/event0', '/dev/input/event1']

BUTTONS = {2: '1', 3: '2', 4: '3', 5: '4', 50: 'm', 28: 'ENTER', 1: 'ESC'}
EV_KEY, EV_REL, REL_DIAL = 1, 2, 6


def translate(etype, code, value):
    if etype == EV_KEY and value == 1:
        return BUTTONS.get(code)
    if etype == EV_REL and code == REL_DIAL:
        if value == 1:
            return 'RIGHT'
        if value in (-1, 4294967295):
            return 'LEFT'
    return None


_last_error_log = 0.0


def send(key):
    global _last_error_log
    body = json.dumps({'key': key}).encode()
    req = urllib.request.Request(URL, data=body, headers={'content-type': 'application/json'}, method='POST')
    try:
        urllib.request.urlopen(req, timeout=1).close()
    except Exception as err:  # server down or cable out: keep reading, log at most once a minute
        if time.time() - _last_error_log > 60:
            print(f'claude-buttons: could not reach {URL}: {err}', file=sys.stderr, flush=True)
            _last_error_log = time.time()


def listen(path):
    while True:
        try:
            with open(path, 'rb') as dev:
                while True:
                    data = dev.read(EVENT_SIZE)
                    if len(data) < EVENT_SIZE:
                        break
                    _s, _us, etype, code, value = struct.unpack(EVENT_FORMAT, data)
                    key = translate(etype, code, value)
                    if key:
                        threading.Thread(target=send, args=(key,), daemon=True).start()
        except OSError as err:
            print(f'claude-buttons: {path}: {err}', file=sys.stderr, flush=True)
        time.sleep(2)


def main():
    threads = [threading.Thread(target=listen, args=(p,), daemon=True) for p in DEVICES]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == '__main__':
    main()
