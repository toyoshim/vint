// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../all_your_file/error.js"
import { RootFs } from "../all_your_file/fs/root_fs.js"
import { MultiImageFs } from "../all_your_file/fs/multi_image_fs.js"
import { FatFs } from "../all_your_file/fs/fat_fs.js"
import { NativeFs } from "../all_your_file/fs/native_fs.js"
import { D88Image } from "../all_your_file/image/d88_image.js"
import { DcuImage } from "../all_your_file/image/dcu_image.js"
import { XdfImage } from "../all_your_file/image/xdf_image.js"
import { NativeIo } from "../all_your_file/io/native_io.js"

// TODO:
//  - file operations.
//  - show current path.
//  - mouse operation.

const roots = [];
roots.push(new RootFs());
roots.push(new RootFs());
const cursors = [[], []];
let activeView = 0;

// Setup buttons
const buttons = [
  {
    id: 'b1',
    label: 'HELP!',
    callback: async () => {
      window.open('https://github.com/toyoshim/vint/wiki/');
    }
  },
  {
    id: 'b2',
    label: 'Mount FS',
    callback: async () => {
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
    }
  },
  {
    id: 'b3',
    label: 'Mnt Image',
    callback: async () => {
      const io = new NativeIo();
      await io.choose({
        types: [
          {
            description: 'All supported images',
            accept: { '*/*': ['.xdf', '.d88', '.dcu'] }
          },
          {
            description: 'XDF - FD image for X68000 emulators',
            accept: { '*/*': ['.xdf'] }
          },
          {
            description: 'D88 - FD image for PC-8801 emulators',
            accept: { '*/*': ['.d88'] }
          },
          {
            description: 'DCU - FD image for Disk Copy Utility',
            accept: { '*/*': ['.dcu'] }
          }
        ]
      });
      const name = (await io.getAttributes()).name.toLowerCase();
      let image;
      if (name.endsWith('.dcu')) {
        image = new DcuImage();
      } else if (name.endsWith('.d88')) {
        image = new D88Image();
      } else {
        image = new XdfImage();
      }
      await image.open(io);
      const imageAttributes = await image.getAttributes();
      let fs;
      if (imageAttributes.bundles) {
        fs = new MultiImageFs();
      } else {
        fs = new FatFs();
      }
      await fs.open(image);
      await roots[0].mount(fs);
      await roots[1].mount(fs);
      if ((await roots[0].getCwd()) == '/') {
        await reload(0);
      }
      if ((await roots[1].getCwd()) == '/') {
        await reload(1);
      }
      activate();
    }
  }
];
for (let entry of buttons) {
  const button = document.getElementById(entry.id);
  button.innerText = entry.label;
  button.addEventListener('click', async () => {
    await entry.callback();
    // A click takes the focus, but it is really confusing to keep it as the next
    // key press may cause the click action for the button. Let's release it and
    // move the focus over the active list view.
    window.frames[activeView].focus();
  });
}

frames[0].addEventListener('keydown', handleKeydown);
frames[1].addEventListener('keydown', handleKeydown);
document.addEventListener('keydown', handleKeydown);

async function handleKeydown(e) {
  if (e.key == 'ArrowUp') {
    postMessage(activeView, 'cursor-up');
  } else if (e.key == 'ArrowDown') {
    postMessage(activeView, 'cursor-down');
  } else if (e.key == 'PageUp') {
    postMessage(activeView, 'cursor-page-up');
  } else if (e.key == 'PageDown') {
    postMessage(activeView, 'cursor-page-down');
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
    postMessage(activeView, 'cursor-down');
  } else if (e.key == '.') {
    // TEST
    console.log(await sendMessage(activeView, 'get-selected'));
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

// Window size for standalone mode.
let resizeWindow = function () {
  var frameWidth = window.outerWidth - window.innerWidth;
  var frameHeight = window.outerHeight - window.innerHeight;
  window.resizeTo(950 + frameWidth, 560 + frameHeight);
}
if (window.matchMedia('(display-mode: standalone)').matches) {
  resizeWindow();
  window.addEventListener('resize', resizeWindow);
}