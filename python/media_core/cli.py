"""Validated, local-only media executor. JSON in/out; no user shell/filter expressions."""
from __future__ import annotations
import json
import array
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any
from PIL import Image, ImageDraw, ImageFont
from jsonschema import validate

ROOT = Path(__file__).resolve().parents[2]
MAX_BYTES = 100 * 1024 * 1024


def run(args: list[str], timeout: int = 300, input_limits: dict[int, float] | None = None) -> str:
    if args[0] == 'ffmpeg':
        # Keep all looping inputs finite and bound decoder thread counts. Unbounded
        # looping overlays can stall FFmpeg's multi-input EOF scheduler.
        bounded = []
        limit = next((args[i+1] for i, value in enumerate(args[:-1]) if value == '-t'), None)
        input_index = 0
        for arg in args:
            if arg == '-i':
                bounded.extend(['-threads', '1'])
                if limit is not None:
                    bounded.extend(['-t', str((input_limits or {}).get(input_index, limit))])
                input_index += 1
            bounded.append(arg)
        args = bounded[:-1] + ['-threads', '2'] + bounded[-1:]
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed: {result.stderr[-1600:]}')
    return result.stdout


def probe(path: str) -> dict[str, Any]:
    with open(path, 'rb') as media_file:
        header = media_file.read(32)
    signatures = [b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff', b'RIFF', b'OggS', b'fLaC', b'ID3', b'\x1aE\xdf\xa3', b'FORM']
    if not (any(header.startswith(sig) for sig in signatures) or header[4:8] in (b'ftyp', b'moov', b'mdat', b'wide') or len(header) > 1 and header[0] == 255 and header[1] & 224 == 224):
        raise ValueError('Unsupported media signature; playlists and arbitrary files are rejected')
    data = json.loads(run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', path], 30))
    streams = data.get('streams', [])
    video = next((s for s in streams if s['codec_type'] == 'video'), None)
    audio = next((s for s in streams if s['codec_type'] == 'audio'), None)
    formats = data.get('format', {}).get('format_name', '').split(',')
    if any(f in formats for f in ['hls', 'dash', 'concat', 'sdp']):
        raise ValueError('Playlist inputs are not supported')
    kind = 'image' if video and video.get('codec_name') in ('png', 'mjpeg', 'webp') and not audio and 'image2' in ','.join(formats) + ','.join(formats).replace('_pipe', '') else ('video' if video else 'audio')
    if video and any(f in formats for f in ['png_pipe','jpeg_pipe','webp_pipe','image2']):
        kind = 'image'
    if not video and not audio:
        raise ValueError('Input has no supported media streams')
    duration = float(data.get('format', {}).get('duration', video.get('duration', 0) if video else audio.get('duration', 0)))
    if not math.isfinite(duration) or duration > 3600:
        raise ValueError('Media duration exceeds one hour')
    if video and (video.get('width', 0) > 4096 or video.get('height', 0) > 4096):
        raise ValueError('Input resolution exceeds 4096 pixels')
    rate = (video.get('r_frame_rate') or '0/1').split('/') if video else ['0', '1']
    fps = float(rate[0]) / float(rate[1]) if float(rate[1]) else 0
    return {'kind': kind, 'fps': fps, 'durationMs': round(duration * 1000), 'width': video.get('width') if video else None, 'height': video.get('height') if video else None, 'hasAudio': bool(audio), 'codec': video.get('codec_name') if video else audio.get('codec_name'), 'sampleRate': int(audio.get('sample_rate', 0)) if audio else None}


def validate_timeline(composition: dict[str, Any]) -> None:
    ids = set()
    total = 0
    for scene in composition['scenes']:
        if scene['id'] in ids or scene['durationMs'] < 100:
            raise ValueError('Invalid or duplicate scene')
        ids.add(scene['id'])
        total += scene['durationMs']
        previous_point = -1
        for point in scene.get('volumeEnvelope', []):
            if point['timeMs'] <= previous_point or point['timeMs'] > scene['durationMs']:
                raise ValueError('Invalid volume envelope timeline')
            previous_point = point['timeMs']
        previous = 0
        word_ids = set()
        for word in scene.get('words', []):
            if word['startMs'] < previous or word['endMs'] <= word['startMs'] or word['endMs'] > scene['durationMs'] or word['id'] in word_ids:
                raise ValueError('Invalid word timing')
            previous = word['endMs']
            word_ids.add(word['id'])
    if total > 600000:
        raise ValueError('Composition exceeds ten minutes')
    for event in composition.get('events', []):
        scene = next((s for s in composition['scenes'] if s['id'] == event['sceneId']), None)
        if scene is None:
            raise ValueError('Missing event scene')
        word = next((w for w in scene.get('words', []) if w['id'] == event.get('wordId')), None)
        if event.get('wordId') and not word:
            raise ValueError('Missing event word')
        if (word['startMs'] if word else 0) + event['offsetMs'] + event['durationMs'] > scene['durationMs']:
            raise ValueError('Event outside scene')


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [os.environ.get('MEDIA_FONT', ''), '/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial Unicode.ttf']
    for name in candidates:
        if name and Path(name).is_file():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size=size)


def wrap(draw: ImageDraw.ImageDraw, text: str, face: Any, width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines() or ['']:
        line = ''
        # Character wrapping also handles CJK and very long words.
        for char in paragraph:
            if draw.textlength(line + char, font=face) > width and line:
                lines.append(line.strip())
                line = char
            else:
                line += char
        lines.append(line.strip())
    return lines


def overlay_text(path: Path, width: int, height: int, text: str, size: int, color: str, background: str, card: bool = False) -> None:
    image = Image.new('RGBA', (width, height), (0,0,0,0))
    draw = ImageDraw.Draw(image)
    face = font(size)
    lines = wrap(draw, text, face, width - 56)
    while len(lines) * (size + 8) > height * .32 and size > 12:
        size -= 2
        face = font(size)
        lines = wrap(draw, text, face, width - 56)
    if len(lines) * (size + 8) > height * .4:
        raise ValueError('Caption text does not fit; split the scene')
    box_height = len(lines) * (size + 8) + 28
    y = round(height * .15) if card else height - box_height - round(height * .1)
    draw.rounded_rectangle((16, y, width-16, y+box_height), radius=12, fill=background + 'ee')
    for index, line in enumerate(lines):
        draw.text(((width-draw.textlength(line, font=face))/2, y+12+index*(size+8)), line, font=face, fill=color)
    image.save(path)


def graphic(path: Path, width: int, height: int, color: str, index: int) -> None:
    image = Image.new('RGB', (width, height), color)
    draw = ImageDraw.Draw(image)
    for ring in range(5):
        radius = width * (.15 + ring * .115)
        x, y = width * .5, height * .39
        draw.ellipse((x-radius,y-radius,x+radius,y+radius), outline='#8dcebc', width=2)
    draw.rounded_rectangle((width*.35,height*.2,width*.65,height*.56),radius=width*.08,fill='#d7f5ae')
    face = font(max(14, width//24))
    draw.text((width*.45,height*.35),f'{index+1:02}',fill='#163b37',font=face)
    draw.text((24,24),f'LOCAL COMPOSITION  /  {index+1:02}',fill='#d7f5ae',font=font(max(12,width//30)))
    image.save(path)


def stamp(milliseconds: int) -> str:
    return f'{milliseconds//3600000:02}:{milliseconds//60000%60:02}:{milliseconds//1000%60:02},{milliseconds%1000:03}'


def audio_filters(scene: dict[str, Any]) -> str:
    speed = scene.get('speed', 1)
    tempos = []
    while speed > 2:
        tempos.append('atempo=2')
        speed /= 2
    while speed < .5:
        tempos.append('atempo=0.5')
        speed /= .5
    tempos.append(f'atempo={speed}')
    points = scene.get('volumeEnvelope', [])
    expression = str(points[-1]['gain']) if points else '1'
    for a, b in reversed(list(zip(points, points[1:]))):
        start, end = a['timeMs'] / 1000, b['timeMs'] / 1000
        linear = f"({a['gain']}+({b['gain']}-{a['gain']})*(t-{start})/({end}-{start}))"
        expression = f'if(lt(t,{end}),{linear},{expression})'
    if points:
        expression = f"if(lt(t,{points[0]['timeMs']/1000}),{points[0]['gain']},{expression})"
    return ','.join(tempos + [f"apad,atrim=duration={scene['durationMs']/1000}",
        'asetpts=PTS-STARTPTS', f"volume='{scene.get('volume', 1)}*({expression})':eval=frame"])


def waveform(payload: dict[str, Any]) -> dict[str, Any]:
    path = payload['path']
    metadata = probe(path)
    start, duration, bins = payload['startMs'], payload['durationMs'], payload['bins']
    if not metadata['hasAudio'] or not 0 <= start < metadata['durationMs'] or not 100 <= duration <= 600000 or not 16 <= bins <= 1024:
        raise ValueError('Invalid waveform input or interval')
    duration = min(duration, metadata['durationMs'] - start)
    # At most 9.6 MB PCM for a ten-minute window; no model download or full-rate decode buffer.
    result = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-threads', '1',
        '-ss', str(start/1000), '-protocol_whitelist', 'file,pipe', '-i', path,
        '-t', str(duration/1000), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
        capture_output=True, timeout=60, check=True)
    samples = array.array('h', result.stdout)
    if sys.byteorder != 'little':
        samples.byteswap()
    peaks = [round(max((abs(v) for v in samples[len(samples)*i//bins:len(samples)*(i+1)//bins]), default=0)/32768, 4) for i in range(bins)]
    return {'schemaVersion': 1, 'startMs': start, 'durationMs': duration, 'peaks': peaks, 'evidence': 'local-real'}


def render(payload: dict[str, Any], work: Path) -> dict[str, Any]:
    composition = payload['composition']
    validate(composition, json.loads((ROOT / 'packages/contracts/schemas/composition.v1.json').read_text()))
    validate_timeline(composition)
    width, height, fps = composition['width'], composition['height'], composition['fps']
    assets = payload.get('assets', {})
    rendered = []
    subtitle_entries = []
    timeline = []
    cursor = 0
    for index, scene in enumerate(composition['scenes']):
        duration = scene['durationMs'] / 1000
        speed = scene.get('speed', 1)
        cmd = ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-filter_complex_threads','1']
        source = assets.get(scene.get('assetId'))
        metadata = probe(source) if source else None
        if source and metadata['kind'] == 'image':
            cmd += ['-loop','1','-framerate',str(fps),'-protocol_whitelist','file,pipe','-i',source]
        elif source:
            if scene.get('sourceStartMs',0)+scene['durationMs']*speed > metadata['durationMs']+100:
                raise ValueError('Scene exceeds source media')
            cmd += ['-ss',str(scene.get('sourceStartMs',0)/1000),'-protocol_whitelist','file,pipe','-i',source]
        else:
            source = str(work / f'graphic-{index}.png')
            graphic(Path(source),width,height,scene['color'],index)
            cmd += ['-loop','1','-framerate',str(fps),'-i',source]
        input_count = 1
        filters = []
        video_speed = speed if metadata and metadata['kind'] == 'video' else 1
        timing = f'setpts=(PTS-STARTPTS)/{video_speed},'
        if scene.get('fit') == 'cover':
            filters.append(f'[0:v]{timing}scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps={fps}[base]')
        else:
            filters.append(f'[0:v]{timing}scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={scene["color"]},setsar=1,fps={fps}[base]')
        video_label = 'base'
        style = composition['captionStyle']
        if scene.get('text'):
            caption = work / f'caption-{index}.png'
            overlay_text(caption,width,height,scene['text'],style['fontSize'],style['color'],style['background'])
            cmd += ['-loop','1','-framerate',str(fps),'-i',str(caption)]
            filters.append(f'[{video_label}][{input_count}:v]overlay=0:0:shortest=1[v{input_count}]')
            video_label = f'v{input_count}'
            input_count += 1
            subtitle_entries.append((cursor, cursor+scene["durationMs"], scene["text"]))
        for event in (e for e in composition.get('events',[]) if e['sceneId']==scene['id']):
            word = next((w for w in scene.get('words',[]) if w['id']==event.get('wordId')),None)
            start = ((word['startMs'] if word else 0)+event['offsetMs'])/1000
            end = start+event['durationMs']/1000
            if event['kind'] == 'text' and event.get('text'):
                subtitle_entries.append((cursor+round(start*1000), cursor+round(end*1000), event['text']))
            if event['kind']=='broll':
                media = assets[event['assetId']]
                meta = probe(media)
                cmd += (['-loop','1'] if meta['kind']=='image' else ['-stream_loop','-1']) + ['-protocol_whitelist','file,pipe','-i',media]
                filters.append(f'[{input_count}:v]scale={width//2//2*2}:{height//3//2*2}:force_original_aspect_ratio=decrease,pad={width//2//2*2}:{height//3//2*2}:(ow-iw)/2:(oh-ih)/2,setsar=1[ev{input_count}]')
                filters.append(f'[{video_label}][ev{input_count}]overlay=(W-w)/2:H*0.18:enable=\'between(t,{start},{end})\'[v{input_count}]')
            else:
                card = work / f'event-{index}-{input_count}.png'
                overlay_text(card,width,height,event['text'],max(14,style['fontSize']-4),style['color'] if event['kind']=='text' else '#173b42',style['background'] if event['kind']=='text' else '#d7f5ae',event['kind']=='card')
                cmd += ['-loop','1','-framerate',str(fps),'-i',str(card)]
                filters.append(f'[{video_label}][{input_count}:v]overlay=0:0:enable=\'between(t,{start},{end})\'[v{input_count}]')
            video_label = f'v{input_count}'
            input_count += 1
        voice = assets.get(scene.get('audioAssetId'))
        if voice:
            cmd += ['-ss',str(scene.get('audioSourceStartMs',0)/1000),'-protocol_whitelist','file,pipe','-i',voice]
            audio_index = input_count
        elif metadata and metadata.get('hasAudio'):
            audio_index = 0
        else:
            cmd += ['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
            audio_index = input_count
        filters.append(f'[{audio_index}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,{audio_filters(scene)}[a]')
        output = work / f'scene-{index}.mp4'
        cmd += ['-filter_complex',';'.join(filters),'-map',f'[{video_label}]','-map','[a]','-t',str(duration),'-r',str(fps),'-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-movflags','+faststart',str(output)]
        run(cmd, input_limits={0: duration * video_speed, audio_index: duration * speed})
        rendered.append(output)
        timeline.append({'id':scene['id'],'startMs':cursor,'endMs':cursor+scene['durationMs']})
        cursor += scene['durationMs']
    # All paths here are server-created filenames, not user text.
    listing = work / 'concat.txt'
    listing.write_text('\n'.join(f"file '{p.name}'" for p in rendered))
    joined = work / 'joined.mp4'
    run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','concat','-safe','1','-i',str(listing),'-vf',f'fps={fps}','-r',str(fps),'-frames:v',str(round(cursor*fps/1000)),'-af','aresample=async=1:first_pts=0','-t',str(cursor/1000),'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac',str(joined)])
    output = work / 'output.mp4'
    audio = composition.get('audio',{})
    if audio.get('assetId') or audio.get('toneHz'):
        cmd = ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i',str(joined)]
        if audio.get('assetId'):
            cmd += ['-stream_loop','-1','-protocol_whitelist','file,pipe','-i',assets[audio['assetId']]]
        else:
            cmd += ['-f','lavfi','-i',f'sine=frequency={audio["toneHz"]}:sample_rate=48000:duration={cursor/1000}']
        cmd += ['-filter_complex',f'[1:a]volume={audio.get("gain",.1)}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0[a]','-map','0:v','-map','[a]','-t',str(cursor/1000),'-c:v','copy','-c:a','aac','-movflags','+faststart',str(output)]
        run(cmd)
    else:
        shutil.copyfile(joined,output)
    subtitles = work / 'captions.srt'
    subtitles.write_text('\n'.join(f'{index+1}\n{stamp(start)} --> {stamp(end)}\n{text}\n' for index, (start, end, text) in enumerate(sorted(subtitle_entries, key=lambda entry: (entry[0], entry[1])))),encoding='utf8')
    if payload.get('preserveAudio'):
        preserved = work / 'preserved.mp4'
        run(['ffmpeg','-v','error','-nostdin','-y','-i',str(output),'-protocol_whitelist','file,pipe','-i',payload['preserveAudio'],'-map','0:v:0','-map','1:a:0?','-c','copy','-movflags','+faststart',str(preserved)])
        shutil.move(preserved,output)
    metadata = probe(str(output))
    run(['ffmpeg','-v','error','-nostdin','-i',str(output),'-f','null','-'])
    frame = work / 'preview.png'
    run(['ffmpeg','-v','error','-nostdin','-y','-ss',str(min(.3, metadata['durationMs']/2000)),'-i',str(output),'-frames:v','1',str(frame)])
    return {'schemaVersion':1,'output':str(output),'subtitles':str(subtitles),'preview':str(frame),'metadata':metadata,'timeline':timeline,'evidence':'local-real'}


def main() -> None:
    payload = json.load(sys.stdin)
    command = payload['command']
    if command == 'probe':
        result = {'schemaVersion':1,'metadata':probe(payload['path'])}
    elif command == 'waveform':
        result = waveform(payload)
    elif command == 'render':
        work = Path(payload['workDir']).resolve()
        work.mkdir(parents=True,exist_ok=True)
        result = render(payload,work)
    elif command == 'transcribe':
        sys.path.insert(0,str(ROOT/'python'))
        from adapters.whisperx_adapter import transcribe
        result = transcribe(payload)
    elif command == 'tts':
        sys.path.insert(0,str(ROOT/'python'))
        from adapters.tts import synthesize
        result = synthesize(payload)
    else:
        raise ValueError('Unsupported command')
    json.dump(result,sys.stdout,ensure_ascii=False)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        json.dump({'schemaVersion':1,'error':str(error),'code':'CAPABILITY_UNAVAILABLE' if isinstance(error,ImportError) else 'MEDIA_FAILED'},sys.stdout)
        sys.exit(1)
