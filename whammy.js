/*jslint browser: true, esnext: true */
// max duration by cluster in milliseconds
var CLUSTER_MAX_DURATION = 30000;
/**
clusterTimecode should be an integer
*/
function makeCuePoint(clusterTimecode) {
    return {
        id: 0xbb,
        data: [
            { id: 0xb3, data: clusterTimecode },
            {
                id: 0xb7,
                data: [
                    { id: 0xf7, data: 1 },
                    { id: 0xf1, data: 0, size: 8 },
                ]
            }
        ]
    };
}
function makeWebMStructure(duration, width, height, cues, clusters) {
    var segments = [
        {
            id: 0x1549a966,
            data: [
                { id: 0x2ad7b1, data: 1e6 },
                { id: 0x4d80, data: "whammy" },
                { id: 0x5741, data: "whammy" },
                { id: 0x4489, data: doubleToString(duration) } // Duration
            ]
        },
        {
            id: 0x1654ae6b,
            data: [{
                    id: 0xae,
                    data: [
                        { id: 0xd7, data: 1 },
                        { id: 0x73c5, data: 1 },
                        { id: 0x9c, data: 0 },
                        { id: 0x22b59c, data: "und" },
                        { id: 0x86, data: "V_VP8" },
                        { id: 0x258688, data: "VP8" },
                        { id: 0x83, data: 1 },
                        {
                            id: 0xe0,
                            data: [
                                { data: width, id: 0xb0 },
                                { data: height, id: 0xba },
                            ]
                        }
                    ]
                }]
        },
        { id: 0x1c53bb6b, data: cues },
    ];
    Array.prototype.push.apply(segments, clusters);
    return [
        {
            id: 0x1a45dfa3,
            data: [
                { id: 0x4286, data: 1 },
                { id: 0x42f7, data: 1 },
                { id: 0x42f2, data: 4 },
                { id: 0x42f3, data: 8 },
                { id: 0x4282, data: "webm" },
                { id: 0x4287, data: 2 },
                { id: 0x4285, data: 2 } // DocTypeReadVersion
            ]
        },
        {
            id: 0x18538067,
            data: segments,
        }
    ];
}
/**
clusterTimecode should be an integer approximation of the actual timecode
clusterCounter should be the actual number.
*/
function makeCluster(clusterTimecode, clusterFrames) {
    var clusterCounter = 0;
    var data = [
        { id: 0xe7, data: clusterTimecode },
    ];
    var frames = clusterFrames.map(function (frame) {
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
        return { id: 0xa3, data: block };
    });
    Array.prototype.push.apply(data, frames);
    return { id: 0x1f43b675, data: data }; // Cluster
}
/**
in this case, frames has a very specific meaning, which will be
detailed once i finish writing the code.
*/
function toWebM(frames, outputAsArray) {
    if (outputAsArray === void 0) { outputAsArray = false; }
    var info = checkFrames(frames);
    var cues = []; // EBML[1].data[2];
    var clusters = [];
    //Generate clusters (max duration)
    var frameNumber = 0;
    var clusterTimecode = 0;
    while (frameNumber < frames.length) {
        // prepare cue
        var clusterTimecode_int = (clusterTimecode + 0.5) | 0;
        var cuePoint = makeCuePoint(clusterTimecode_int);
        // add cue
        cues.push(cuePoint);
        // prepare cluster
        var clusterFrames = [];
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
    var segment = webm_structure[1];
    // segment[0]: Info
    // segment[1]: Tracks
    // segment[2]: Cues
    // segment[3+]: Clusters
    // First pass to compute cluster positions
    var position = 0;
    for (var i = 0; i < segment.data.length; i++) {
        if (i >= 3) {
            cues[i - 3].data[1].data[1].data = position;
        }
        var data = serializeEBML([segment.data[i]], outputAsArray);
        position += data.size || data.byteLength || data.length;
        if (i != 2) {
            // Save results to avoid having to encode everything twice
            segment.data[i] = data;
        }
    }
    return serializeEBML(webm_structure, outputAsArray);
}
exports.toWebM = toWebM;
/** sums the lengths of all the frames and gets the duration, woo */
function checkFrames(frames) {
    var width = frames[0].width;
    var height = frames[0].height;
    var duration = frames[0].duration;
    for (var i = 1, frame; (frame = frames[i]) !== undefined; i++) {
        if (frame.width != width) {
            throw "Frame " + (i + 1) + " has an unusual width: " + frame.width + "; it should be " + width;
        }
        if (frame.height != height) {
            throw "Frame " + (i + 1) + " has an unusual height: " + frame.height + "; it should be " + height;
        }
        if (frame.duration < 0 || frame.duration > 0x7fff) {
            throw "Frame " + (i + 1) + " has a weird duration (must be between 0 and 32767)";
        }
        duration += frame.duration;
    }
    return { duration: duration, width: width, height: height };
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
function bitsToBuffer(bits) {
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
function serializeEBML(trees, outputAsArray) {
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
        return new Blob(ebml, { type: "video/webm" });
    }
}
function flatten(input, output) {
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
function makeSimpleBlock(data) {
    var flags = 0;
    if (data.keyframe) {
        flags |= 128;
    }
    ;
    if (data.invisible) {
        flags |= 8;
    }
    ;
    if (data.lacing) {
        flags |= (data.lacing << 1);
    }
    ;
    if (data.discardable) {
        flags |= 1;
    }
    ;
    if (data.trackNum > 127) {
        throw "TrackNumber > 127 not supported";
    }
    return [
        data.trackNum | 0x80,
        data.timecode >> 8,
        data.timecode & 0xff,
        flags,
    ].map(function (entry) { return String.fromCharCode(entry); }).join('') + data.frame;
}
// here's something else taken verbatim from weppy, awesome rite?
function parseWebP(riff, duration) {
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
    return { width: width, height: height, data: data, riff: riff, duration: duration };
}
function format8bit(char) {
    var unpadded = char.charCodeAt(0).toString(2);
    return (new Array(8 - unpadded.length + 1)).join('0') + unpadded;
}
function parseRIFF(riff) {
    var offset = 0;
    var chunks = {};
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
var Video = (function () {
    function Video(frames) {
        if (frames === void 0) { frames = []; }
        this.frames = frames;
    }
    Video.prototype.compile = function (outputAsArray) {
        var frames = this.frames.map(function (raw_frame) {
            // "data:image/png;base64,".length === 22
            var riff = parseRIFF(atob(raw_frame.image.slice(23)));
            return parseWebP(riff, raw_frame.duration);
        });
        return toWebM(frames, outputAsArray);
    };
    Object.defineProperty(Video.prototype, "duration", {
        get: function () {
            return this.frames.map(function (frame) { return frame.duration; }).reduce(function (a, b) { return a + b; }, 0);
        },
        enumerable: true,
        configurable: true
    });
    return Video;
})();
exports.Video = Video;
function fromImageArray(images, frames_per_second, outputAsArray) {
    var duration = 1000 / frames_per_second;
    var raw_frames = images.map(function (image) {
        return { image: image, duration: duration };
    });
    var video = new Video(raw_frames);
    return video.compile(outputAsArray);
}
exports.fromImageArray = fromImageArray;
