"""Local system TTS. Uses installed voices only, without a model download."""
from pathlib import Path
import platform
import shutil
import subprocess


def synthesize(payload):
    if payload['language'] not in ('en', 'en-US', 'en-GB', 'zh', 'zh-CN'):
        raise ValueError('Local TTS currently supports en/zh only; unsupported languages are never substituted')
    output = Path(payload['workDir'])/'voice.wav'
    text_path = output.with_suffix('.txt')
    text_path.write_text(payload['text'],encoding='utf8')
    voice = payload.get('voice','default')
    if platform.system()=='Darwin' and shutil.which('say'):
        selected = ('Tingting' if payload['language'].startswith('zh') else 'Samantha') if voice=='default' else voice
        args=['say','-v',selected,'-f',str(text_path),'-o',str(output),'--data-format=LEI16@24000']
    elif shutil.which('espeak-ng'):
        selected = payload['language'] if voice=='default' else voice
        args=['espeak-ng','-v',selected,'-f',str(text_path),'-w',str(output)]
    else:
        raise ImportError('Install espeak-ng or configure an installed macOS voice')
    subprocess.run(args,capture_output=True,timeout=90,check=True)
    return {'schemaVersion':1,'output':str(output),'evidence':'local-real','engine':'system-tts','voice':selected,'language':payload['language']}
