// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../all_your_file/error.js"
import { RootFs } from "../all_your_file/fs/root_fs.js"
import { FatFs } from "../all_your_file/fs/fat_fs.js"
import { NativeFs } from "../all_your_file/fs/native_fs.js"
import { XdfImage } from "../all_your_file/image/xdf_image.js"
import { NativeIo } from "../all_your_file/io/native_io.js"

// TODO:
//  - file operations.
//  - show current path.
//  - D88 support.
//  - DCU support.

const roots = [];
roots.push(new RootFs());
roots.push(new RootFs());
const cursors = [[], []];
let activeView = 0;

const b2 = document.getElementById('b2');
b2.innerText = 'Mount FS';
b2.addEventListener('click', async () => {
  const fs = new NativeFs();
  await fs.choose();
  await roots[0].mount(fs);
  await roots[1].mount(fs);
  if ((await roots[0].getCwd()) == '/') {
    await reload(0);
  }
  if ((await roots[1].getCwd()) == '/') {
    await reload(1);
  }
  activate();
});

const b3 = document.getElementById('b3');
b3.innerText = 'Mount XDF';
b3.addEventListener('click', async () => {
  const io = new NativeIo();
  await io.choose();
  const xdf = new XdfImage();
  await xdf.open(io);
  const fs = new FatFs();
  await fs.open(xdf);
  await roots[0].mount(fs);
  await roots[1].mount(fs);
  if ((await roots[0].getCwd()) == '/') {
    await reload(0);
  }
  if ((await roots[1].getCwd()) == '/') {
    await reload(1);
  }
  activate();
});

const b5 = document.getElementById('b5');
b5.innerText = 'Debug';
b5.addEventListener('click', async () => {
});

frames[0].addEventListener('keydown', handleKeydown);
frames[1].addEventListener('keydown', handleKeydown);
document.addEventListener('keydown', handleKeydown);

async function handleKeydown(e) {
  if (e.key == 'ArrowUp') {
    postMessage(activeView, 'cursor-up');
  } else if (e.key == 'ArrowDown') {
    postMessage(activeView, 'cursor-down');
  } else if (e.key == 'ArrowLeft') {
    if (activeView == 1) {
      activeView = 0;
      activate();
    } else if (await roots[activeView].getCwd() != '/') {
      await roots[activeView].chdir('..');
      await reload(activeView);
      postMessage(activeView, 'cursor-set', {
        cursor: cursors[activeView].pop()
      });
    }
  } else if (e.key == 'ArrowRight') {
    if (activeView == 0) {
      activeView = 1;
      activate();
    } else if (await roots[activeView].getCwd() != '/') {
      await roots[activeView].chdir('..');
      await reload(activeView);
      postMessage(activeView, 'cursor-set', {
        cursor: cursors[activeView].pop()
      });
    }
  } else if (e.key == 'Enter') {
    const result = await sendMessage(activeView, 'get-current');
    if (result.data.directory) {
      await roots[activeView].chdir(result.data.name);
      cursors[activeView].push(result.data.cursor);
      await reload(activeView);
    }
  } else if (e.key == ' ') {
    postMessage(activeView, 'select');
  } else {
    console.log(e);
  }
}

function activate() {
  postMessage(0, 'active', activeView == 0);
  postMessage(1, 'active', activeView == 1);
}

let resolver = null;
window.addEventListener('message', e => {
  if (resolver) {
    resolver(e.data);
    resolver = null;
  }
});

function sendMessage(view, cmd, data) {
  return new Promise((resolve, reject) => {
    resolver = resolve;
    postMessage(view, cmd, data);
  });
}

function postMessage(view, cmd, data) {
  frames[view].postMessage({
    id: 'vint',
    cmd: cmd,
    data: data
  }, document.location.origin);
}

async function reload(view) {
  postMessage(view, 'reset');
  await roots[view].list(entry => {
    if (entry.volume || (entry.name == '.') || (entry.name == '..')) {
      return false;
    }
    postMessage(view, 'add', {
      name: entry.name,
      ext: '',
      size: entry.size,
      date: entry.modified,
      directory: entry.directory,
      mount: entry.mount
    });
    return false;
  });
}