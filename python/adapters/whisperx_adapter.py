"""Optional WhisperX adapter; never downloads weights in the default installation."""
import os
from pathlib import Path


def transcribe(payload):
    model_path = os.environ.get('WHISPERX_MODEL_PATH')
    if not model_path or not Path(model_path).is_dir():
        raise ImportError('Configure a preinstalled WHISPERX_MODEL_PATH and the optional WhisperX environment')
    import whisperx
    device = os.environ.get('WHISPERX_DEVICE','cpu')
    model = whisperx.load_model(model_path,device,compute_type='int8' if device=='cpu' else 'float16',language=payload['language'],local_files_only=True)
    audio = whisperx.load_audio(payload['path'])
    result = model.transcribe(audio,batch_size=4,language=payload['language'])
    alignment = os.environ.get('WHISPERX_ALIGN_MODEL_PATH')
    if not alignment or not Path(alignment).is_dir():
        raise ImportError('Configure local alignment weights in WHISPERX_ALIGN_MODEL_PATH')
    align_model, metadata = whisperx.load_align_model(language_code=result['language'],device=device,model_name=alignment)
    aligned = whisperx.align(result['segments'],align_model,metadata,audio,device)
    words=[]
    for word in aligned['word_segments']:
        if 'start' not in word or 'end' not in word:
            raise ValueError('Unaligned word; manual correction required')
        words.append({'id':f'w{len(words)}','text':word['word'],'startMs':round(word['start']*1000),'endMs':round(word['end']*1000)})
    return {'schemaVersion':1,'language':result['language'],'durationMs':round(len(audio)/16000*1000),'words':words,'evidence':'local-real'}
