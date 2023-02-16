// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../all_your_file/error.js"
import { RootFs } from "../all_your_file/fs/root_fs.js"
import { FatFs } from "../all_your_file/fs/fat_fs.js"
import { NativeFs } from "../all_your_file/fs/native_fs.js"
import { XdfImage } from "../all_your_file/image/xdf_image.js"
import { NativeIo } from "../all_your_file/io/native_io.js"

const roots = [];
roots.push(new RootFs());
roots.push(new RootFs());

const b2 = document.getElementById('b2');
b2.innerText = 'Mount FS';
b2.addEventListener('click', async () => {
  const fs = new NativeFs();
  await fs.choose();
  await roots[0].mount(fs);
  await roots[1].mount(fs);
  if ((await roots[0].getCwd()) == '/') {
    reload(0);
  }
  if ((await roots[1].getCwd()) == '/') {
    reload(1);
  }
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
    reload(0);
  }
  if ((await roots[1].getCwd()) == '/') {
    reload(1);
  }
});

const b5 = document.getElementById('b5');
b5.innerText = 'Debug';
b5.addEventListener('click', async () => {
  await roots[0].list(async e => {
    if (e.name.startsWith('CH68')) {
      await roots[0].chdir(e.name);
    }
  });
  reload(0);
});


function postMessage(view, cmd, data) {
  frames[view].postMessage({
    id: 'vint',
    cmd: cmd,
    data: data
  }, document.location.origin);
}

function reload(view) {
  postMessage(view, 'reset');
  roots[view].list(entry => {
    if (entry.label) {
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