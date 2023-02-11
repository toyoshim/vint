// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"
import { FatFsIo } from "../io/fat_fs_io.js"

// TODO:
//  1. create a new directory.
//  2. remove the directory.
//  3. expand dirent case.
//  4. remove a file with content.

function getAscii(buffer, offset, size) {
  const end = offset + size;
  const chars = [];
  for (let i = offset; i < end; ++i) {
    chars.push(String.fromCharCode(buffer[i]));
  }
  return chars.join('');
}

function getShort(buffer, offset) {
  return (buffer[offset + 1] << 8) | buffer[offset];
}

function getLong(buffer, offset) {
  return (getShort(buffer, offset + 2) << 16) | getShort(buffer, offset);
}

function getEntryName(buffer, offset) {
  const chars = [];
  for (let i = 0; i < 8; ++i) {
    if (buffer[offset + i] == 0x20) {
      break;
    }
    if (i == 0 && (buffer[offset] == 0x05)) {
      chars.push(0xe5);
    } else {
      chars.push(buffer[offset + i]);
    }
  }
  // Human68k extension.
  for (let i = 12; i < 21; ++i) {
    if (buffer[offset + i] == 0) {
      break;
    }
    chars.push(buffer[offset + i]);
  }
  for (let i = 8; i < 11; ++i) {
    if (buffer[offset + i] == 0x20) {
      break;
    }
    if (i == 8) {
      chars.push('.'.charCodeAt(0));
    }
    chars.push(buffer[offset + i]);
  }
  return chars;
}

function createEntryName(name) {
  let nameArray = null;
  if (window.Encoding) {
    nameArray = Encoding.convert(Encoding.stringToCode(name), {
      to: 'SJIS',
      from: 'UNICODE'
    });
  } else {
    nameArray = [];
    for (let c of name) {
      nameArray.push(c.charCodeAt(0));
    }
  }
  let dotIndex = -1;
  for (let i = nameArray.length - 1; i >= 0; --i) {
    if (nameArray[i] == 0x2e) {
      dotIndex = i;
      break;
    }
  }
  const extLength = nameArray.length - dotIndex - 1;
  let extArray = null;
  let baseArray = null;
  if (dotIndex >= 0 && extLength <= 3) {
    extArray = nameArray.slice(dotIndex + 1);
    baseArray = nameArray.slice(0, dotIndex);
  } else {
    extArray = [];
    baseArray = nameArray;
  }
  if (baseArray[0] == 0xe5) {
    baseArray[0] = 0x05;
  }
  if (baseArray.length > 17) {
    throw Error.createInvalidName('too long: ' + name);
  }
  for (let i = baseArray.length; i < 8; ++i) {
    baseArray[i] = 0x20;
  }
  for (let i = baseArray.length; i < 17; ++i) {
    baseArray[i] = 0x00;
  }
  for (let i = extArray.length; i < 3; ++i) {
    extArray[i] = 0x20;
  }
  return {
    base: baseArray.slice(0, 8),
    ext: extArray,
    human: baseArray.slice(8, 17)
  };
}

function getTimestamp(date, time, subtime) {
  const year = 1980 + (date >> 9);
  const month = (date >> 5) & 15;
  const day = date & 31;
  const hour = time ? ((time >> 11) & 31) : 0;
  const minute = time ? ((time >> 5) & 63) : 0;
  let second = time ? ((time & 31) * 2) : 0;
  if (subtime) {
    second += subtime / 100;
  }
  let msec = second;
  second |= 0;
  msec = ((msec - second) * 1000) | 0;
  const timestamp = new Date();
  timestamp.setFullYear(year);
  timestamp.setMonth((month || 1) - 1);
  timestamp.setDate(day || 1);
  timestamp.setHours(hour);
  timestamp.setMinutes(minute);
  timestamp.setSeconds(second, msec);
  return timestamp;
}

function createTimestamp(optionalDate) {
  const now = optionalDate || new Date();
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  const time =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    (now.getSeconds() >> 1);
  const subtime =
    (now.getSeconds() & 1) * 100 + (now.getMilliseconds() / 100) | 0;
  return {
    date: date,
    time: time,
    subtime: subtime,
    now: now
  };
}

function countBlock(n, block) {
  return ((n + block - 1) / block) | 0;
}

function findAvailableEntry(entry) {
  for (let offset = 0; offset < entry.byteLength; offset += 32) {
    if (entry[offset] == 0xe5 || entry[offset] == 0) {
      return offset / 32;
    }
  }
  return -1;
}

export class FatFs {
  #image = null;
  #oemName = '';
  #bytesPerSector = 0;
  #sectorPerCluster = 0;
  #reservedSectorCount = 0;
  #fatCount = 0;
  #rootEntryCount = 0;
  #totalSectors = 0;
  #mediaType = 0;
  #fatSectors = 0;
  #sectorsPerTrack = 0;
  #headCount = 0;
  #hiddenSectors = 0;
  #volumeId = 0;
  #volumeLabel = '';
  #fatTypeString = '';
  #fatStartSector = 0;
  #rootDirectoryStartSector = 0;
  #rootDirectorySectors = 0;
  #dataStartSector = 0;
  #dataSectors = 0;
  #fatType = 0;
  #fat = null;
  #currentDirectoryStartCluster = 0;
  #currentDirectoryClusters = 0;
  #path = [];

  async open(image) {
    if (this.#image) {
      throw Error.createInvalidRequest();
    }
    const attributes = await image.getAttributes();
    const bootSector = new Uint8Array(await image.read(0));
    this.#oemName = getAscii(bootSector, 3, 8);
    this.#bytesPerSector = getShort(bootSector, 11);
    this.#sectorPerCluster = bootSector[13];
    this.#reservedSectorCount = getShort(bootSector, 14);
    this.#fatCount = bootSector[16];
    this.#rootEntryCount = getShort(bootSector, 17);
    this.#totalSectors = getShort(bootSector, 19);
    this.#mediaType = bootSector[21];
    this.#fatSectors = getShort(bootSector, 22);
    this.#sectorsPerTrack = getShort(bootSector, 24);
    this.#headCount = getShort(bootSector, 26);
    this.#hiddenSectors = getLong(bootSector, 28);
    if (this.#totalSectors == 0) {
      this.#totalSectors = getLong(bootSector, 32);
    }
    if (bootSector[38] == 0x29) {
      this.#volumeId = getLong(bootSector, 39);
      this.#volumeLabel = getAscii(bootSector, 43, 11);
      this.#fatTypeString = getAscii(bootSector, 54, 8);
    }
    if (this.#bytesPerSector != attributes.bytesPerSector) {
      throw Error.createInvalidFormat('inconsistent sector size');
    }
    if (this.#sectorsPerTrack != attributes.sectorsPerTrack) {
      throw Error.createInvalidFormat('inconsistent sectors/track');
    }
    if (this.#totalSectors != attributes.sectorsPerTrack * attributes.tracks) {
      throw Error.createInvalidFormat('inconsistent total tracks');
    }

    this.#fatStartSector = this.#reservedSectorCount;
    this.#rootDirectoryStartSector =
      this.#fatStartSector + this.#fatSectors * this.#fatCount;
    this.#rootDirectorySectors =
      countBlock(32 * this.#rootEntryCount, this.#bytesPerSector);
    this.#dataStartSector =
      this.#rootDirectoryStartSector + this.#rootDirectorySectors;
    this.#dataSectors = this.#totalSectors - this.#dataSectors;

    const clusters = (this.#dataSectors / this.#sectorPerCluster) | 0;
    if (clusters < 4086) {
      this.#fatType = 12;
    } else if (clusters < 65526) {
      this.#fatType = 16;
    } else {
      this.#fatType = 32;
    }
    if (this.#fatType != 12) {
      throw Error.createInvalidFormat('fat16/fat32 are not supported');
    }
    this.#image = image;
    this.#fat = await this.#readSectors(this.#fatStartSector, this.#fatSectors);
    await this.#list(async entry => {
      if (!entry.volume) {
        return false;
      }
      this.#volumeLabel = entry.name;
      return true;
    }, true);
    this.#path = [];
  }

  async list(observer) {
    await this.#list(observer, true);
  }

  async chdir(name) {
    let found = false;
    await this.#list(async entry => {
      if (!entry.directory || entry.name != name) {
        return false;
      }
      if (entry.cluster == 0) {
        // Root directory.
        this.#currentDirectoryStartCluster = 0;
        this.#currentDirectoryClusters = 0;
        this.#path = [];
        found = true;
        return true;
      }
      // Sub directory.
      let size = 0;
      for (let cluster = entry.cluster; cluster != 0xfff; size++) {
        cluster = await this.#getFat(cluster);
        if (!cluster) {
          throw Error.createInvalidFormat('invalid directory entry');
        }
      }
      this.#currentDirectoryStartCluster = entry.cluster;
      this.#currentDirectoryClusters = size;
      if (name == '..') {
        this.#path.pop();
      } else {
        this.#path.push(name);
      }
      found = true;
      return true;
    }, true);
    if (!found) {
      throw Error.createNotFound();
    }
  }

  async mkdir(name) {
    // TODO
  }

  async remove(name) {
    let found = false;
    await this.#list(async entry => {
      if (entry.name != name) {
        return false;
      }
      if (entry.directory) {
        throw Error.createNotImplemented();
      } else {
        // Remove a file.
        if (entry.size) {
          // TODO: release sectors.
          throw Error.createNotImplemented();
        }
        const offset = entry.index * 32;
        entry.directoryEntry.data[offset] = 0xe5;
        const index = (offset / this.#bytesPerSector) | 0;
        const start = index * this.#bytesPerSector;
        const end = start + this.#bytesPerSector;
        await this.#image.write(
          entry.directoryEntry.sectors[index],
          entry.directoryEntry.data.slice(start, end).buffer
        );
      }
      found = true;
      return true;
    }, true);
    if (!found) {
      throw Error.createNotFound();
    }
  }

  async getIo(name, options) {
    let io = null;
    await this.#list(async entry => {
      if (io || entry.directory || entry.name != name) {
        return false;
      }
      if (options && options.create) {
        throw Error.createInvalidRequest('already exist');
      }
      io = new FatFsIo(this.#appendIoAttributes({
        name: entry.name,
        size: entry.size,
        lastModified: entry.modified,
        startCluster: entry.cluster
      }));
      return true;
    }, true);
    if (!io && options && options.create) {
      // Create a new file.
      const directory = await this.#readDirectoryEntries();
      const index = findAvailableEntry(directory.data);
      if (index < 0) {
        // TODO: expand for non-root directory.
        throw Error.createNoSpace();
      }
      const entry = createEntryName(name);
      entry.directory = false;
      entry.writable =
        (options.writable !== undefined) ? options.writable : true;
      entry.readable =
        (options.readable !== undefined) ? options.readable : true;
      entry.system =
        (options.system !== undefined) ? options.system : false;
      entry.created = options.created;
      entry.accessed = options.accessed;
      entry.modified = options.modified;
      const result = this.#updateEntry(directory, index, entry);
      for (let i = 0; i < directory.dirty.length; ++i) {
        if (!directory.dirty[i]) {
          continue;
        }
        const start = i * this.#bytesPerSector;
        const end = start + this.#bytesPerSector;
        await this.#image.write(
          directory.sectors[i],
          directory.data.slice(start, end).buffer);
      }
      io = new FatFsIo(this.#appendIoAttributes({
        name: name,
        size: 0,
        lastModified: result.modified,
        startCluster: 0
      }));
    }
    if (!io) {
      throw Error.createNotFound();
    }
    return io;
  }

  async flush() {
    this.#image.flush();
  }

  async close() {
    this.flush();
    this.#image = null;
  }

  async getAttributes() {
    return {
      encoding: 'Shift_JIS',
      volumeLabel: this.#volumeLabel
    };
  }

  async getCwd() {
    return '/' + this.#path.join('/');
  }

  async #list(observer, showPrivate) {
    const directoryEntry = await this.#readDirectoryEntries();
    const directory = directoryEntry.data;
    const isHuman = this.#oemName.startsWith('X68');
    for (let index = 0; index < this.#rootEntryCount; ++index) {
      const firstEntry = directory[32 * index];
      if (firstEntry == 0xe5) {
        // Deleted entry.
        continue;
      } else if (firstEntry == 0) {
        // No more entry.
        break;
      }
      const name = getEntryName(directory, 32 * index);
      const attributes = directory[32 * index + 11];
      if ((attributes & 0x08) && !showPrivate) {
        // Volume entry is private.
        continue;
      }
      const created = isHuman ? undefined : getTimestamp(
        getShort(directory, 32 * index + 16),
        getShort(directory, 32 * index + 14),
        directory[32 * index + 13]
      );
      const accessed = isHuman ? undefined : getTimestamp(
        getShort(directory, 32 * index + 18));
      const modified = getTimestamp(
        getShort(directory, 32 * index + 24),
        getShort(directory, 32 * index + 22)
      );
      const data = {
        name: name,
        writable: (attributes & 0x01) == 0,
        readable: (attributes & 0x02) == 0,
        system: (attributes & 0x04) != 0,
        volume: (attributes & 0x08) != 0,
        directory: (attributes & 0x10) != 0,
        archive: (attributes & 0x20) != 0,
        created: created,
        accessed: accessed,
        modified: modified,
        size: getLong(directory, 32 * index + 28)
      };
      if (window.Encoding) {
        data.nameArray = data.name;
        const unicodeArray = Encoding.convert(data.name, {
          to: 'UNICODE',
          from: 'SJIS'
        });
        data.name = Encoding.codeToString(unicodeArray);
        data.rawName = data.nameArray.join('');
      } else {
        data.name = data.name.join('');
      }
      if (showPrivate) {
        const clusterHigh = isHuman ? 0 : getShort(directory, 32 * index + 20);
        const clusterLow = getShort(directory, 32 * index + 26);
        data.cluster = (clusterHigh << 16) | clusterLow;
        data.index = index;
        data.directoryEntry = directoryEntry;
      }
      const stop = await observer(data);
      if (stop) {
        break;
      }
    }
  }

  async #readSectors(sector, count) {
    const buffer = new ArrayBuffer(this.#bytesPerSector * count);
    const dst = new Uint8Array(buffer);
    for (let i = 0; i < count; ++i) {
      const src = new Uint8Array(await this.#image.read(sector + i));
      const offset = this.#bytesPerSector * i;
      for (let j = 0; j < this.#bytesPerSector; ++j) {
        dst[offset + j] = src[j];
      }
    }
    return dst;
  }

  async #readClusters(cluster, count) {
    const buffer =
      new ArrayBuffer(this.#bytesPerSector * this.#sectorPerCluster * count);
    const dst = new Uint8Array(buffer);
    const sectors = [];
    const dirty = [];
    for (let i = 0; i < count; ++i) {
      const sector =
        this.#dataStartSector + (cluster - 2) * this.#sectorPerCluster;
      for (let j = 0; j < this.#sectorPerCluster; ++j) {
        const src = new Uint8Array(await this.#image.read(sector + j));
        sectors.push(sector + j);
        dirty.push(false);
        const offset = this.#bytesPerSector * (i * this.#sectorPerCluster + j);
        for (let k = 0; k < this.#bytesPerSector; ++k) {
          dst[offset + k] = src[k];
        }
      }
      cluster = this.#getFat(cluster);
    }
    return { data: dst, sectors: sectors, dirty: dirty };
  }

  async #readDirectoryEntries() {
    if (this.#currentDirectoryStartCluster == 0) {
      const sectors = [];
      const dirty = [];
      for (let i = 0; i < this.#rootDirectorySectors; ++i) {
        sectors.push(this.#rootDirectoryStartSector + i);
        dirty.push(false);
      }
      return {
        data: await this.#readSectors(
          this.#rootDirectoryStartSector,
          this.#rootDirectorySectors),
        sectors: sectors,
        dirty: dirty
      };
    } else {
      return await this.#readClusters(
        this.#currentDirectoryStartCluster,
        this.#currentDirectoryClusters);
    }
  }

  async #getFat(cluster) {
    if (cluster & 1) {
      const offset = (cluster * 1.5) | 0;
      return (this.#fat[offset + 1] << 4) | (this.#fat[offset] >> 4);
    } else {
      const offset = (cluster * 1.5) | 0;
      return ((this.#fat[offset + 1] & 0x0f) << 8) | this.#fat[offset];
    }
  }

  async #updateEntry(directory, index, entry) {
    const offset = index * 32;
    const data = directory.data;
    for (let i = 0; i < 8; ++i) {
      data[offset + i] = entry.base[i];
    }
    for (let i = 0; i < 3; ++i) {
      data[offset + 8 + i] = entry.ext[i];
    }
    data[offset + 11] =
      (entry.writable ? 0x00 : 0x01) |
      (entry.readable ? 0x00 : 0x02) |
      (entry.system ? 0x04 : 0x00) |
      (entry.directory ? 0x10 : 0x00);
    for (let i = 0; i < 9; ++i) {
      data[offset + 12 + i] = entry.human[i];
    }
    const modified = createTimestamp(entry.modified);
    data[offset + 22] = modified.time & 0xff;
    data[offset + 23] = (modified.time >> 8) & 0xff;
    data[offset + 24] = modified.date & 0xff;
    data[offset + 25] = (modified.date >> 8) & 0xff;

    // cluster is not assigned.
    data[offset + 26] = 0;
    data[offset + 27] = 0;

    // size starts with 0.
    data[offset + 28] = 0;
    data[offset + 29] = 0;
    data[offset + 30] = 0;
    data[offset + 31] = 0;

    directory.dirty[(offset / this.#bytesPerSector) | 0] = true;

    return { modified: modified.now };
  }

  #appendIoAttributes(object) {
    object.bytesPerCluster = this.#bytesPerSector * this.#sectorPerCluster;
    object.getFat = this.#getFat.bind(this);
    object.readClusters = this.#readClusters.bind(this);
    object.flush = this.flush.bind(this);
    return object;
  }
}