/*jslint browser: true, esnext: true */

// max duration by cluster in milliseconds
const CLUSTER_MAX_DURATION = 30000;

interface Frame {
  data: string;
  duration: number;
  riff: any;
  width: number;
  height: number;
}

interface KVTree {
  id: number;
  data: string | number | KVTree[];
  size?: number;
}

/**
clusterTimecode should be an integer
*/
function makeCuePoint(clusterTimecode: number): KVTree {
  return {
    id: 0xbb, // CuePoint
    data: [
      {id: 0xb3, data: clusterTimecode}, // CueTime
      {
        id: 0xb7, // CueTrackPositions
        data: [
          {id: 0xf7, data: 1}, // CueTrack
          {id: 0xf1, data: 0, size: 8}, // CueClusterPosition, to be filled in when we know it
        ]
      }
    ]
  };
}

function makeWebMStructure(duration: number, width: number, height: number,
                           cues: KVTree[], clusters: KVTree[]): KVTree[] {
  var segments: KVTree[] = [
    {
      id: 0x1549a966, // Info
      data: [
        {id: 0x2ad7b1, data: 1e6}, // TimecodeScale: do things in millisecs (num of nanosecs for duration scale)
        {id:   0x4d80, data: "whammy"}, // MuxingApp
        {id:   0x5741, data: "whammy"}, // WritingApp
        {id:   0x4489, data: doubleToString(duration)} // Duration
      ]
    },
    {
      id: 0x1654ae6b, // Tracks
      data: [{
        id: 0xae, // TrackEntry
        data: [
          {id:     0xd7, data: 1}, // TrackNumber
          {id:   0x73c5, data: 1}, // TrackUID
          {id:     0x9c, data: 0}, // FlagLacing
          {id: 0x22b59c, data: "und"}, // Language
          {id:     0x86, data: "V_VP8"}, // CodecID
          {id: 0x258688, data: "VP8"}, // CodecName
          {id:     0x83, data: 1}, // TrackType
          {
            id: 0xe0, // Video
            data: [
              {data: width, id: 0xb0}, // PixelWidth
              {data: height, id: 0xba}, // PixelHeight
            ]
          }
        ]
      }]
    },
    {id: 0x1c53bb6b, data: cues},
    // clusters get pushed on here
  ];
  Array.prototype.push.apply(segments, clusters);
  return [
    {
      id: 0x1a45dfa3, // EBML
      data: [
        {id: 0x4286, data: 1}, // EBMLVersion
        {id: 0x42f7, data: 1}, // EBMLReadVersion
        {id: 0x42f2, data: 4}, // EBMLMaxIDLength
        {id: 0x42f3, data: 8}, // EBMLMaxSizeLength
        {id: 0x4282, data: "webm"}, // DocType
        {id: 0x4287, data: 2}, // DocTypeVersion
        {id: 0x4285, data: 2} // DocTypeReadVersion
      ]
    },
    {
      id: 0x18538067, // Segment
      data: segments,
    }
  ];
}

/**
clusterTimecode should be an integer approximation of the actual timecode
clusterCounter should be the actual number.
*/
function makeCluster(clusterTimecode: number, clusterFrames: Frame[]): KVTree {
  var clusterCounter = 0;
  var data: KVTree[] = [
    {id: 0xe7, data: clusterTimecode}, // Timecode
  ];
  var frames = clusterFrames.map(frame => {
    var block = makeSimpleBlock({
      discardable: 0,
      frame: frame.data.slice(4),
      invisible: 0,
      keyframe: 1,
      lacing: 0,
      trackNum: 1,
      timecode: (clusterCounter + 0.5) | 0
    });
    clusterCounter += frame.duration;
    return {id: 0xa3, data: block};
  });
  Array.prototype.push.apply(data, frames);
  return {id: 0x1f43b675, data: data}; // Cluster
}

/**
in this case, frames has a very specific meaning, which will be
detailed once i finish writing the code.
*/
export function toWebM(frames: Frame[], outputAsArray: boolean = false) {
  var info = checkFrames(frames);

  var cues: KVTree[] = []; // EBML[1].data[2];
  var clusters: KVTree[] = [];

  //Generate clusters (max duration)
  var frameNumber = 0;
  var clusterTimecode = 0;
  while (frameNumber < frames.length) {
    // prepare cue
    var clusterTimecode_int = (clusterTimecode + 0.5) | 0
    var cuePoint = makeCuePoint(clusterTimecode_int);
    // add cue
    cues.push(cuePoint);

    // prepare cluster
    var clusterFrames: Frame[] = [];
    var clusterDuration = 0;
    do {
      clusterFrames.push(frames[frameNumber]);
      clusterDuration += frames[frameNumber].duration;
      frameNumber++;
    } while (frameNumber < frames.length && clusterDuration < CLUSTER_MAX_DURATION);
    // add cluster
    var cluster = makeCluster(clusterTimecode_int, clusterFrames);
    clusters.push(cluster);

    clusterTimecode += clusterDuration;
  }

  var webm_structure = makeWebMStructure(info.duration, info.width, info.height, cues, clusters);
  var segment: any = webm_structure[1];
  // segment[0]: Info
  // segment[1]: Tracks
  // segment[2]: Cues
  // segment[3+]: Clusters

  // First pass to compute cluster positions
  var position = 0;
  for (var i = 0; i < segment.data.length; i++) {
    if (i >= 3) { // if i refers to a cluster
      cues[i - 3].data[1].data[1].data = position;
    }
    var data: any = serializeEBML([segment.data[i]], outputAsArray);
    position += data.size || data.byteLength || data.length;
    if (i != 2) { // not cues
      // Save results to avoid having to encode everything twice
      segment.data[i] = data;
    }
  }

  return serializeEBML(webm_structure, outputAsArray);
}

/** sums the lengths of all the frames and gets the duration, woo */
function checkFrames(frames: Frame[]) {
  var width = frames[0].width;
  var height = frames[0].height;
  var duration = frames[0].duration;
  for (var i = 1, frame; (frame = frames[i]) !== undefined; i++) {
    if (frame.width != width) {
      throw `Frame ${i + 1} has an unusual width: ${frame.width}; it should be ${width}`;
    }
    if (frame.height != height) {
      throw `Frame ${i + 1} has an unusual height: ${frame.height}; it should be ${height}`;
    }
    if (frame.duration < 0 || frame.duration > 0x7fff) {
      throw `Frame ${i + 1} has a weird duration (must be between 0 and 32767)`;
    }
    duration += frame.duration;
  }
  return {duration, width, height};
}

function numToBuffer(num) {
  var parts = [];
  while (num > 0) {
    parts.push(num & 0xff);
    num = num >> 8;
  }
  return new Uint8Array(parts.reverse());
}

function numToFixedBuffer(num, size) {
  var parts = new Uint8Array(size);
  for (var i = size - 1; i >= 0; i--) {
    parts[i] = num & 0xff;
    num = num >> 8;
  }
  return parts;
}

/**
For-loop is faster than:

    return new Uint8Array(str.split('').map(e => e.charCodeAt(0))
*/
function strToBuffer(str) {
  // return new Blob([str]);
  var arr = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i);
  }
  return arr;
}

//sorry this is ugly, and sort of hard to understand exactly why this was done
// at all really, but the reason is that there's some code below that i dont really
// feel like understanding, and this is easier than using my brain.

function bitsToBuffer(bits: string): Uint8Array {
  var data = [];
  var pad = (bits.length % 8) ? (new Array(1 + 8 - (bits.length % 8))).join('0') : '';
  bits = pad + bits;
  for (var i = 0; i < bits.length; i += 8) {
    data.push(parseInt(bits.substr(i, 8), 2));
  }
  return new Uint8Array(data);
}

/**
serializeEBML converts an Array of KVTree to string
*/
function serializeEBML(trees: KVTree[], outputAsArray): Blob | Uint8Array {
  var ebml = [];
  for (var i = 0, tree; (tree = trees[i]) !== undefined; i++) {
    if (!('id' in tree)) {
      // throw 'already encoded blob or byteArray'; // not sure if this will happen
      ebml.push(tree);
      continue;
    }

    var data = tree.data;
    if (Array.isArray(data)) {
      data = serializeEBML(data, outputAsArray);
    }
    if (typeof data == 'number') {
      var number_size = tree.size;
      data = (number_size !== undefined) ? numToFixedBuffer(data, number_size) : bitsToBuffer(data.toString(2));
    }
    if (typeof data == 'string') {
      data = strToBuffer(data);
    }

    var len = data.size || data.byteLength || data.length;
    var zeroes = Math.ceil(Math.ceil(Math.log(len) / Math.log(2)) / 8);
    var size_str = len.toString(2);
    var padded = (new Array((zeroes * 7 + 7 + 1) - size_str.length)).join('0') + size_str;
    var size = (new Array(zeroes)).join('0') + '1' + padded;

    //i actually dont quite understand what went on up there, so I'm not really
    //going to fix this, i'm probably just going to write some hacky thing which
    //converts that string into a buffer-esque thing

    ebml.push(numToBuffer(tree.id));
    ebml.push(bitsToBuffer(size));
    ebml.push(data);
  }

  //output as blob or byteArray
  if (outputAsArray) {
    // convert ebml to an array
    var buffer = flatten(ebml, []);
    return new Uint8Array(buffer);
  }
  else {
    return new Blob(ebml, {type: "video/webm"});
  }
}

function flatten(input: any[], output: any[]) {
  for (var i = 0, item; (item = input[i]) !== undefined; i++) {
    if (Array.isArray(item)) {
      flatten(item, output);
    }
    else {
      output.push(item);
    }
  }
  return output;
}

//OKAY, so the following two functions are the string-based old stuff, the reason they're
//still sort of in here, is that they're actually faster than the new blob stuff because
//getAsFile isn't widely implemented, or at least, it doesn't work in chrome, which is the
// only browser which supports get as webp

//woot, a function that's actually written for this project!
//this parses some json markup and makes it into that binary magic
//which can then get shoved into the matroska comtainer (peaceably)

function makeSimpleBlock(data): string {
  var flags = 0;
  if (data.keyframe) { flags |= 128 };
  if (data.invisible) { flags |= 8 };
  if (data.lacing) { flags |= (data.lacing << 1) };
  if (data.discardable) { flags |= 1 };
  if (data.trackNum > 127) {
    throw "TrackNumber > 127 not supported";
  }
  return [
    data.trackNum | 0x80,
    data.timecode >> 8,
    data.timecode & 0xff,
    flags,
  ].map(entry => String.fromCharCode(entry)).join('') + data.frame;
}

// here's something else taken verbatim from weppy, awesome rite?

function parseWebP(riff: Riff, duration: number): Frame {
  // grab the VP8 string as `data`
  var data = riff.RIFF[0].WEBP[0];
  // A VP8 keyframe starts with the 0x9d012a header
  var frame_start = data.indexOf('\x9d\x01\x2a');
  for (var i = 0, c = []; i < 4; i++) {
    c[i] = data.charCodeAt(frame_start + 3 + i);
  }

  //the code below is literally copied verbatim from the bitstream spec
  var tmp = (c[1] << 8) | c[0];
  var width = tmp & 0x3FFF;
  var horizontal_scale = tmp >> 14;
  tmp = (c[3] << 8) | c[2];
  var height = tmp & 0x3FFF;
  var vertical_scale = tmp >> 14;
  return {width, height, data, riff, duration};
}

function format8bit(char) {
  var unpadded = char.charCodeAt(0).toString(2);
  return (new Array(8 - unpadded.length + 1)).join('0') + unpadded;
}

// i think i'm going off on a riff by pretending this is some known
// idiom which i'm making a casual and brilliant pun about, but since
// i can't find anything on google which conforms to this idiomatic
// usage, I'm assuming this is just a consequence of some psychotic
// break which makes me make up puns. well, enough riff-raff (aha a
// rescue of sorts), this function was ripped wholesale from weppy

interface Riff {
  RIFF?: Riff[];
  LIST?: Riff[];
  WEBP?: string[];
  [index: string]: any;
}

function parseRIFF(riff: string): Riff {
  var offset = 0;
  var chunks: Riff = {};

  while (offset < riff.length) {
    var id = riff.substr(offset, 4);
    chunks[id] = chunks[id] || [];
    if (id == 'RIFF' || id == 'LIST') {
      var len = parseInt(riff.substr(offset + 4, 4).split('').map(format8bit).join(''), 2);
      var data = riff.substr(offset + 8, len);
      offset += 8 + len;
      chunks[id].push(parseRIFF(data));
    }
    else if (id == 'WEBP') {
      // Use (offset + 8) to skip past "VP8 "/"VP8L"/"VP8X" field after "WEBP"
      chunks[id].push(riff.substr(offset + 8));
      break;
    }
    else {
      // Unknown chunk type; push entire payload
      chunks[id].push(riff.substr(offset + 4));
      break;
    }
  }
  return chunks;
}

// here's a little utility function that acts as a utility for other functions
// basically, the only purpose is for encoding "Duration", which is encoded as
// a double (considerably more difficult to encode than an integer)
function doubleToString(num) {
  // create a float64 array, extract the array buffer, convert into an Uint8Array
  var uint_array = new Uint8Array(new Float64Array([num]).buffer);
  // uint_array.length should always be 8, I think
  var chars = new Array(8);
  for (var i = 0; i < 8; i++) {
    // put them in reverse order (little endian)
    chars[7 - i] = String.fromCharCode(uint_array[i]);
  }
  return chars.join('');
}

interface RawFrame {
  image: string; // base64-encoded WebP image DataURL
  duration: number;
}

export class Video {
  constructor(public frames: RawFrame[] = []) { }

  compile(outputAsArray: boolean) {
    var frames = this.frames.map(raw_frame => {
      // "data:image/png;base64,".length === 22
      var riff = parseRIFF(atob(raw_frame.image.slice(23)));
      return parseWebP(riff, raw_frame.duration);
    });
    return toWebM(frames, outputAsArray);
  }

  get duration() {
    return this.frames.map(frame => frame.duration).reduce((a, b) => a + b, 0);
  }
}

export function fromImageArray(images: string[], frames_per_second: number, outputAsArray: boolean) {
  var duration = 1000 / frames_per_second;
  var raw_frames = images.map(image => {
    return {image, duration};
  });
  var video = new Video(raw_frames);
  return video.compile(outputAsArray);
}
