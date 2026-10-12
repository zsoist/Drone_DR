"""Strict JSON contract for suggested clip insights. No external dependencies."""
import math
import re

PRAISE = re.compile(
    r'\b(?:excelentes?|impresionantes?|majestuos[oa]s?|espectacular(?:es)?|'
    r'increíbles?|increibles?|hermos[oa]s?|bell[oa]s?|maravillos[oa]s?|'
    r'asombros[oa]s?|magnífic[oa]s?|magnific[oa]s?|perfect[oa]s?|'
    r'fascinantes?|deslumbrantes?|precios[oa]s?|idílic[oa]s?)\b', re.I)


def neutral_caption(value):
    return re.sub(r'\s+([,.;:])', r'\1', ' '.join(PRAISE.sub('', value).split())).strip()


def trim_caption(value):
    """Keep a neutral first clause, with a word boundary at 60 characters."""
    value = neutral_caption(value)
    value = re.split(r'[.;!?]\s|,\s', value, maxsplit=1)[0].strip(' .;,:!?')
    if len(value) > 60:
        value = value[:61].rsplit(' ', 1)[0][:60].rstrip(' .;,:!?')
        value = re.sub(r'(?:\s+(?:de|del|en|con|entre|y|o|a|al|el|la|los|las|un|una))+$', '', value, flags=re.I)
    return value or 'Vista aérea'


def valid_short(value):
    return (isinstance(value, str) and value == value.strip()
            and 1 <= len(value) <= 60 and not PRAISE.search(value)
            and '\n' not in value and '\r' not in value)

LOOKS = ['none', 'nolan', 'deakins', 'malick', 'fincher', 'kodak', 'goldenhour',
         'tealorange', 'cine', 'vivid', 'warm', 'moody', 'bw']
SHOTS = ['órbita', 'revelación', 'cenital', 'FPV', 'travelling', 'paneo',
         'ascenso', 'descenso', 'estático', 'seguimiento', 'mixto']


def obj(properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties),
            'additionalProperties': False}


def text(limit=600):
    return {'type': 'string', 'minLength': 1, 'maxLength': limit}


def array(item, minimum=0, maximum=20):
    return {'type': 'array', 'items': item, 'minItems': minimum, 'maxItems': maximum}


TIME = {'type': 'number', 'minimum': 0, 'maximum': 86400}
INSIGHT_SCHEMA = obj({
    'caption': text(), 'caption_short': text(60),
    'tags': array(text(80), 1), 'subjects': array(text(100)),
    'shot_type': {'type': 'string', 'enum': SHOTS},
    'scene_type': {'type': 'string', 'enum': ['urbano', 'naturaleza', 'costa', 'montaña',
                                           'atardecer', 'interior', 'mixto']},
    'best_frame_times': array(TIME, 1, 6),
    'highlight_segments': array(obj({'start': TIME, 'end': TIME,
        'score': {'type': 'number', 'minimum': 0, 'maximum': 1}, 'reason': text(240)}), 1, 8),
    'light_notes': text(300), 'color_notes': text(300),
    'suggested_look': obj({'preset_id': {'type': 'string', 'enum': LOOKS},
        'exposure_ev': {'type': 'number', 'minimum': -2, 'maximum': 2}}),
    'quality_flags': array({'type': 'string', 'enum': ['inestable', 'horizonte', 'sobreexpuesto']}, 0, 3),
})


def validate(value, schema=INSIGHT_SCHEMA, path='$'):
    kind = schema['type']
    valid = {'object': isinstance(value, dict), 'array': isinstance(value, list),
             'string': isinstance(value, str),
             'number': type(value) in (int, float) and math.isfinite(value)}
    if not valid[kind]:
        raise ValueError(f'{path}: invalid {kind}')
    if kind == 'object':
        if set(value) != set(schema['required']):
            raise ValueError(f'{path}: missing or unknown fields')
        for key, item in value.items():
            validate(item, schema['properties'][key], f'{path}.{key}')
    elif kind == 'array':
        if not schema['minItems'] <= len(value) <= schema['maxItems']:
            raise ValueError(f'{path}: invalid length')
        for item in value:
            validate(item, schema['items'], path + '[]')
    elif kind == 'string':
        if not schema.get('minLength', 0) <= len(value.strip()) <= schema.get('maxLength', 1000):
            raise ValueError(f'{path}: invalid text length')
    elif not schema['minimum'] <= value <= schema['maximum']:
        raise ValueError(f'{path}: out of range')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError(f'{path}: unknown value')
    return value


def validate_insight(value, duration, frame_times):
    validate(value)
    if not valid_short(value['caption_short']):
        raise ValueError('caption_short must be neutral and at most 60 characters')
    if any(t not in frame_times or t > duration for t in value['best_frame_times']):
        raise ValueError('best frames must be sampled frames inside the clip')
    for segment in value['highlight_segments']:
        if not 0 <= segment['start'] < segment['end'] <= duration:
            raise ValueError('highlight outside clip')
    return value
