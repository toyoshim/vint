// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"
import { FatFsIo } from "../io/fat_fs_io.js"

const IPL = {
  B1_Human: 0x1c,
  B1_9SCFMT: 0x1e,
};

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

function updateEntryWithOptions(entry, options) {
  entry.writable =
    (options.writable !== undefined) ? options.writable : true;
  entry.readable =
    (options.readable !== undefined) ? options.readable : true;
  entry.system =
    (options.system !== undefined) ? options.system : false;
  entry.created = options.created;
  entry.accessed = options.accessed;
  entry.modified = options.modified;
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

export class FatFs {
  #image = null;
  #oemName = '';
  #bytesPerSector = 0;
  #sectorsPerCluster = 0;
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
  #lastClusterId = 0;
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
    if (bootSector[0] == 0x60 &&
      (bootSector[1] == IPL.B1_Human || bootSector[1] == IPL.B1_9SCFMT)) {
      this.#readHumanHeader(bootSector, attributes);
    } else {
      this.#readMsdosHeader(bootSector);
    }
    if (this.#bytesPerSector != attributes.bytesPerSector) {
      throw Error.createInvalidFormat('inconsistent sector size', this);
    }
    if (this.#sectorsPerTrack != attributes.sectorsPerTrack) {
      throw Error.createInvalidFormat('inconsistent sectors/track', this);
    }
    if (this.#totalSectors != attributes.sectorsPerTrack * attributes.tracks) {
      throw Error.createInvalidFormat('inconsistent total tracks', this);
    }

    this.#fatStartSector = this.#reservedSectorCount;
    this.#rootDirectoryStartSector =
      this.#fatStartSector + this.#fatSectors * this.#fatCount;
    this.#rootDirectorySectors =
      countBlock(32 * this.#rootEntryCount, this.#bytesPerSector);
    this.#dataStartSector =
      this.#rootDirectoryStartSector + this.#rootDirectorySectors;
    this.#dataSectors = this.#totalSectors - this.#dataSectors;

    const clusters = (this.#dataSectors / this.#sectorsPerCluster) | 0;
    this.#lastClusterId = clusters + 1;
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
    await this.#list(
      await this.#readDirectoryEntries(),
      async entry => {
        if (!entry.volume) {
          return false;
        }
        this.#volumeLabel = entry.name;
        return true;
      }, true);
    if (this.#volumeLabel.length == 0) {
      this.#volumeLabel = (await this.#image.getAttributes()).name;
    }
    this.#path = [];
  }

  async clone() {
    const fs = new FatFs();
    await fs.open(this.#image);
    return fs;
  }

  async list(observer) {
    await this.#list(await this.#readDirectoryEntries(), observer, true);
  }

  async chdir(name) {
    let found = false;
    await this.#list(
      await this.#readDirectoryEntries(),
      async entry => {
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
        this.#currentDirectoryStartCluster = entry.cluster;
        this.#currentDirectoryClusters =
          await this.#countFatLink(entry.cluster);
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

  async mkdir(name, options) {
    let found = false;
    await this.#list(
      await this.#readDirectoryEntries(),
      async entry => {
        if (entry.name != name) {
          return false;
        }
        found = true;
        return true;
      });
    if (found) {
      throw Error.createInvalidRequest('already exist');
    }
    const directory = await this.#readDirectoryEntries();
    const index = await this.#findAvailableEntry(directory);
    const cluster = await this.#findAvailableCluster();
    await this.#setFat(cluster, 0xfff);
    await this.#flushFat();
    const entry = createEntryName(name);
    updateEntryWithOptions(entry, options || {});
    entry.directory = true;
    entry.cluster = cluster;
    const result = await this.#updateEntry(directory, index, entry);
    await this.#flushDirectoryEntry(directory);
    const buffer = new ArrayBuffer(this.#bytesPerSector);
    const sector = this.#convertClusterToSector(cluster);
    for (let i = 1; i < this.#sectorsPerCluster; ++i) {
      await this.#image.write(sector + i, buffer);
    }
    const newDirectory = {
      data: new Uint8Array(buffer),
      sectors: [sector],
      dirty: [false]
    };
    const currentDir = {
      base: [0x2e, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]
    };
    updateEntryWithOptions(currentDir, {
      modified: result.modified
    });
    currentDir.directory = true;
    currentDir.cluster = cluster;
    await this.#updateEntry(newDirectory, 0, currentDir);
    const parentDir = {
      base: [0x2e, 0x2e, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]
    };
    updateEntryWithOptions(parentDir, {
      modified: result.modified
    });
    parentDir.directory = true;
    parentDir.cluster = this.#currentDirectoryStartCluster;
    await this.#updateEntry(newDirectory, 1, parentDir);
    await this.#flushDirectoryEntry(newDirectory);
  }

  async remove(name) {
    let found = false;
    await this.#list(
      await this.#readDirectoryEntries(),
      async entry => {
        if (entry.name != name) {
          return false;
        }
        if (entry.directory) {
          // Check if the directory is empty.
          let found = false;
          await this.#list(
            await this.#readDirectoryEntries(entry.cluster),
            async entry => {
              if (entry.name == '.' || entry.name == '..') {
                return false;
              }
              found = true;
              return true;
            }, false);
          if (found) {
            throw Error.createNotEmpty();
          }
        }
        // Remove the sub-directory entry or the file content.
        if (entry.cluster) {
          await this.#releaseFat(entry.cluster);
          await this.#flushFat();
        }
        // Remove the entry for the file or the directory.
        const offset = entry.index * 32;
        entry.directoryEntry.data[offset] = 0xe5;
        const index = (offset / this.#bytesPerSector) | 0;
        const start = index * this.#bytesPerSector;
        const end = start + this.#bytesPerSector;
        await this.#image.write(
          entry.directoryEntry.sectors[index],
          entry.directoryEntry.data.slice(start, end).buffer
        );
        found = true;
        return true;
      }, true);
    if (!found) {
      throw Error.createNotFound();
    }
  }

  async getIo(name, options) {
    let io = null;
    await this.#list(
      await this.#readDirectoryEntries(),
      async entry => {
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
        }, entry.directoryEntry, entry.index));
        return true;
      }, true);
    if (!io && options && options.create) {
      // Create a new file.
      const directory = await this.#readDirectoryEntries();
      const index = await this.#findAvailableEntry(directory);
      const entry = createEntryName(name);
      updateEntryWithOptions(entry, options);
      entry.directory = false;
      const result = await this.#updateEntry(directory, index, entry);
      await this.#flushDirectoryEntry(directory);
      io = new FatFsIo(this.#appendIoAttributes({
        name: name,
        size: 0,
        lastModified: result.modified,
        startCluster: 0
      }, directory, index));
    }
    if (!io) {
      throw Error.createNotFound();
    }
    return io;
  }

  async flush() {
    await this.#image.flush();
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

  async #list(directoryEntry, observer, showPrivate) {
    const directory = directoryEntry.data;
    const isHuman = this.#isHuman();
    for (let index = 0; index < directoryEntry.entries; ++index) {
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
    const dirty = [];
    for (let i = 0; i < count; ++i) {
      const src = new Uint8Array(await this.#image.read(sector + i));
      const offset = this.#bytesPerSector * i;
      for (let j = 0; j < this.#bytesPerSector; ++j) {
        dst[offset + j] = src[j];
      }
      dirty.push(false);
    }
    return {
      data: dst,
      dirty: dirty
    };
  }

  async #readClusters(cluster, count) {
    const buffer =
      new ArrayBuffer(this.#bytesPerSector * this.#sectorsPerCluster * count);
    const dst = new Uint8Array(buffer);
    const sectors = [];
    const dirty = [];
    for (let i = 0; i < count; ++i) {
      if (cluster == 0xfff) {
        throw Error.createInvalidFormat('unexpected end mark to read dirent');
      }
      const sector = this.#convertClusterToSector(cluster);
      for (let j = 0; j < this.#sectorsPerCluster; ++j) {
        const src = new Uint8Array(await this.#image.read(sector + j));
        sectors.push(sector + j);
        dirty.push(false);
        const offset = this.#bytesPerSector * (i * this.#sectorsPerCluster + j);
        for (let k = 0; k < this.#bytesPerSector; ++k) {
          dst[offset + k] = src[k];
        }
      }
      cluster = await this.#getFat(cluster);
    }
    return { data: dst, sectors: sectors, dirty: dirty };
  }

  async #readDirectoryEntries(cluster) {
    let startCluster;
    let clusters;
    if (cluster) {
      startCluster = cluster;
      clusters = await this.#countFatLink(cluster);
    } else {
      startCluster = this.#currentDirectoryStartCluster;
      clusters = this.#currentDirectoryClusters;
    }
    if (startCluster == 0) {
      // Root directory.
      const sectors = [];
      const dirty = [];
      for (let i = 0; i < this.#rootDirectorySectors; ++i) {
        sectors.push(this.#rootDirectoryStartSector + i);
        dirty.push(false);
      }
      return {
        data: (await this.#readSectors(
          this.#rootDirectoryStartSector,
          this.#rootDirectorySectors)).data,
        entries: this.#rootEntryCount,
        sectors: sectors,
        dirty: dirty,
        start: startCluster,
      };
    } else {
      // Sub-directory entry.
      const result = await this.#readClusters(startCluster, clusters);
      result.entries = result.sectors.length * this.#bytesPerSector / 32;
      result.start = startCluster;
      return result;
    }
  }

  async #getFat(cluster) {
    const offset = (cluster * 1.5) | 0;
    if (cluster & 1) {
      return (this.#fat.data[offset + 1] << 4) |
        (this.#fat.data[offset] >> 4);
    } else {
      return ((this.#fat.data[offset + 1] & 0x0f) << 8) |
        this.#fat.data[offset];
    }
  }

  async #setFat(cluster, value) {
    const offset = (cluster * 1.5) | 0;
    if (cluster & 1) {
      this.#fat.data[offset + 1] = (value >> 4);
      this.#fat.data[offset] = (this.#fat.data[offset] & 0x0f) |
        ((value & 0x0f) << 4);
    } else {
      this.#fat.data[offset + 1] = (this.#fat.data[offset + 1] & 0xf0) |
        (value >> 8);
      this.#fat.data[offset] = value & 0xff;
    }
    this.#fat.dirty[(offset / this.#bytesPerSector) | 0] = true;
    this.#fat.dirty[((offset + 1) / this.#bytesPerSector) | 0] = true;
  }

  async #releaseFat(cluster) {
    const next = await this.#getFat(cluster);
    await this.#setFat(cluster, 0);
    if (2 <= next && next < 0xfff) {
      await this.#releaseFat(next);
    }
  }

  async #flushFat() {
    for (let i = 0; i < this.#fat.dirty.length; ++i) {
      if (!this.#fat.dirty[i]) {
        continue;
      }
      const start = i * this.#bytesPerSector;
      const end = start + this.#bytesPerSector;
      const buffer = this.#fat.data.slice(start, end).buffer;
      await this.#image.write(this.#fatStartSector + i, buffer);
      await this.#image.write(
        this.#fatStartSector + this.#fatSectors + i, buffer);
      this.#fat.dirty[i] = false;
    }
  }

  async #countFatLink(cluster) {
    let size = 0;
    for (let link = cluster; link != 0xfff; size++) {
      link = await this.#getFat(link);
      if (link <= 2) {
        throw Error.createInvalidFormat('invalid fat ID appears: ' + link);
      }
    }
    return size;
  }

  async #findAvailableCluster() {
    for (let i = 2; i <= this.#lastClusterId; ++i) {
      if ((await this.#getFat(i)) == 0) {
        return i;
      }
    }
    throw Error.createNoSpace();
  }

  async #findAvailableEntry(directory) {
    const entry = directory.data;
    for (let offset = 0; offset < entry.byteLength; offset += 32) {
      if (entry[offset] == 0xe5 || entry[offset] == 0) {
        return offset / 32;
      }
    }
    if (directory.start == 0) {
      throw Error.createNoSpace('cannot expand root dirent');
    }
    const newCluster = await this.#findAvailableCluster();
    let lastCluster = directory.start;
    while (true) {
      const nextCluster = await this.#getFat(lastCluster);
      if (nextCluster == 0xfff) {
        await this.#setFat(lastCluster, newCluster);
        await this.#setFat(newCluster, 0xfff);
        await this.#flushFat();
        break;
      }
      lastCluster = nextCluster;
    }
    const buffer = new ArrayBuffer(this.#bytesPerSector);
    const sector = this.#convertClusterToSector(newCluster);
    for (let i = 0; i < this.#sectorsPerCluster; ++i) {
      await this.#image.write(sector + i, buffer);
      directory.sectors.push(sector + i);
      directory.dirty.push(false);
      directory.entries += this.#bytesPerSector / 32;
    }
    const previousData = directory.data;
    const newSize =
      previousData.byteLength + this.#bytesPerSector * this.#sectorsPerCluster;
    directory.data = new Uint8Array(newSize);
    for (let i = 0; i < previousData.byteLength; ++i) {
      directory.data[i] = previousData[i];
    }
    if (this.#currentDirectoryStartCluster == directory.start) {
      this.#currentDirectoryClusters++;
    }
    return (previousData.byteLength / 32) | 0;
  }

  async #updateEntry(directory, index, entry) {
    const offset = index * 32;
    const data = directory.data;
    for (let i = 0; i < 8; ++i) {
      data[offset + i] = entry.base[i];
    }
    for (let i = 0; i < 3; ++i) {
      data[offset + 8 + i] = entry.ext ? entry.ext[i] : 0x20;
    }
    data[offset + 11] =
      (entry.writable ? 0x00 : 0x01) |
      (entry.readable ? 0x00 : 0x02) |
      (entry.system ? 0x04 : 0x00) |
      (entry.directory ? 0x10 : 0x00);
    if (this.#isHuman()) {
      for (let i = 0; i < 9; ++i) {
        data[offset + 12 + i] = entry.human ? entry.human[i] : 0;
      }
    }
    const modified = createTimestamp(entry.modified);
    data[offset + 22] = modified.time & 0xff;
    data[offset + 23] = (modified.time >> 8) & 0xff;
    data[offset + 24] = modified.date & 0xff;
    data[offset + 25] = (modified.date >> 8) & 0xff;

    // cluster is not assigned.
    data[offset + 26] = entry.cluster ? (entry.cluster & 0xff) : 0;
    data[offset + 27] = entry.cluster ? ((entry.cluster >> 8) & 0xff) : 0;

    // size starts with 0.
    data[offset + 28] = 0;
    data[offset + 29] = 0;
    data[offset + 30] = 0;
    data[offset + 31] = 0;

    directory.dirty[(offset / this.#bytesPerSector) | 0] = true;

    return { modified: modified.now };
  }

  async #flushDirectoryEntry(directory) {
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
  }

  #appendIoAttributes(object, directory, index) {
    object.bytesPerSector = this.#bytesPerSector;
    object.sectorsPerCluster = this.#sectorsPerCluster;
    object.getFat = this.#getFat.bind(this);
    object.setFat = this.#setFat.bind(this);
    object.flushFat = this.#flushFat.bind(this);
    object.findAvailableCluster = this.#findAvailableCluster.bind(this);
    object.readClusters = this.#readClusters.bind(this);
    object.writeSector = this.#image.write.bind(this.#image);
    object.flush = this.flush.bind(this);
    object.updateEntry = (options) => {
      const offset = index * 32;
      const data = directory.data;
      if (options.startCluster) {
        data[offset + 26] = options.startCluster & 0xff;
        data[offset + 27] = (options.startCluster >> 8) & 0xff;
      }
      if (options.size) {
        data[offset + 28] = options.size & 0xff;
        data[offset + 29] = (options.size >> 8) & 0xff;
        data[offset + 30] = (options.size >> 16) & 0xff;
        data[offset + 31] = (options.size >> 24) & 0xff;
      }
      const modified = createTimestamp(options.modified);
      data[offset + 22] = modified.time & 0xff;
      data[offset + 23] = (modified.time >> 8) & 0xff;
      data[offset + 24] = modified.date & 0xff;
      data[offset + 25] = (modified.date >> 8) & 0xff;

      directory.dirty[(offset / this.#bytesPerSector) | 0] = true;
    };
    object.flushEntry = this.#flushDirectoryEntry.bind(this, directory);
    return object;
  }

  #convertClusterToSector(cluster) {
    return this.#dataStartSector + (cluster - 2) * this.#sectorsPerCluster;
  }

  #isHuman() {
    return this.#oemName.startsWith('X68') ||
      this.#oemName.startsWith('Hudson soft 1.') ||
      this.#oemName.startsWith('9SCFMT IPL v1.');
  }

  #readMsdosHeader(bootSector) {
    this.#oemName = getAscii(bootSector, 3, 8);
    this.#bytesPerSector = getShort(bootSector, 11);
    this.#sectorsPerCluster = bootSector[13];
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
  }

  #readHumanHeader(bootSector, attributes) {
    this.#oemName = getAscii(bootSector, 2, 16);
    console.assert(this.#isHuman(), this.#oemName);

    // These fields are probably correct as the numbers are very special.
    this.#bytesPerSector = (bootSector[0x12] << 8) | bootSector[0x13];
    this.#rootEntryCount = bootSector[0x19];
    this.#totalSectors = (bootSector[0x1a] << 8) | bootSector[0x1b];
    this.#sectorsPerTrack = attributes.sectorsPerTrack;
    this.#mediaType = bootSector[0x1c];
    console.assert(this.#bytesPerSector == 1024);
    console.assert(this.#rootEntryCount == 192);
    console.assert(
      this.#totalSectors == attributes.sectorsPerTrack * attributes.tracks);
    switch (this.#mediaType) {
      case 0xfb:  // 2HS
        console.assert(this.#totalSectors == 1440);
        console.assert(this.#sectorsPerTrack == 9);
        this.#headCount = 2;
        break;
      case 0xfe:  // 2HD
        console.assert(this.#totalSectors == 1232);
        console.assert(this.#sectorsPerTrack == 8);
        this.#headCount = 2;
        break;
      default:
        console.assert(false, this.#mediaType.toString(16), bootSector);
    }

    // These fields are estimated via compsrison among early human and 9scfmt.
    // E.g. sectors/count = 2/2 on early human, but 3/1 on 9scfmt 2HS.
    this.#fatSectors = bootSector[0x15];
    this.#fatCount = bootSector[0x1d];

    // Following fields are not unique enough to identify the correct mapping.
    // We may be able to ensure them by feeding a modified image to the X68k.
    console.assert(bootSector[0x16] == 0x00);
    console.assert(bootSector[0x18] == 0x00);
    this.#hiddenSectors = 0;
    this.#volumeId = 0;

    console.assert(bootSector[0x14] == 0x01);
    console.assert(bootSector[0x17] == 0x01);
    this.#sectorsPerCluster = 1;
    this.#reservedSectorCount = 1;

    // These fileds are not in the header.
    this.#volumeLabel = '';
    this.#fatTypeString = '';
  }
}