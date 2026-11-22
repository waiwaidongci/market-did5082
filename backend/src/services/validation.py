import csv
import io
import math
from collections import Counter
from datetime import date
from src.domain import analysis
from src.domain.spec import SPEC


def cell(field, raw):
    label, kind = field['label'], field['type']
    value = raw.strip() if isinstance(raw, str) else raw
    if value is None or value == '':
        if field.get('required', True):
            raise ValueError(f'{label}不能为空')
        return None
    try:
        if kind == 'int':
            if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
                raise ValueError
            value = int(value)
        elif kind == 'number':
            if isinstance(value, bool):
                raise ValueError
            value = float(value)
            if not math.isfinite(value):
                raise ValueError
        elif kind == 'date':
            value = date.fromisoformat(str(value)).isoformat()
        elif kind == 'bool':
            values = {'true': True, 'false': False, '1': True, '0': False, '是': True, '否': False}
            value = values[str(value).lower()]
        elif kind in {'select', 'string'}:
            if not isinstance(value, str) or len(value) > field.get('max_length', 300):
                raise ValueError
            if kind == 'select' and value not in field['options']:
                raise ValueError
    except (TypeError, ValueError, KeyError, OverflowError):
        raise ValueError(f'{label}格式不正确，请检查字段说明') from None
    if kind in {'int', 'number'}:
        if 'min' in field and value < field['min']:
            raise ValueError(f'{label}最小为 {field["min"]}')
        if 'max' in field and value > field['max']:
            raise ValueError(f'{label}最大为 {field["max"]}')
    return value


def parse_rows(text):
    reader = csv.DictReader(io.StringIO(text.removeprefix('\ufeff'), newline=''), strict=True)
    fields = SPEC['fields']
    keys = {field['key'] for field in fields}
    required = {field['key'] for field in fields if field.get('required', True)}
    shift_field = SPEC.get('shift_field')
    allowed = keys | {shift_field['key']} if shift_field else keys
    rows, quarantined = [], []
    try:
        headers = reader.fieldnames or []
        if not required <= set(headers) or not set(headers) <= allowed or len(headers) != len(set(headers)):
            raise ValueError('CSV 表头与字段说明不符，请下载模板检查列名')
        version = 'v2' if shift_field and shift_field['key'] in headers else 'v1'
        parsed = []
        for raw in reader:
            if len(parsed) + len(quarantined) >= 5000:
                raise ValueError('一个数据批次最多导入 5000 行')
            try:
                if None in raw or any(value is None for value in raw.values()):
                    raise ValueError('工作表的列数与表头不一致')
                row = {field['key']: cell(field, raw.get(field['key'])) for field in fields}
            except ValueError as error:
                raise ValueError(f'CSV 第 {reader.line_num} 行 · {error}') from None
            if version == 'v2':
                raw_shift = raw.get(shift_field['key'])
                try:
                    row['shift'] = cell(shift_field, raw_shift)
                except ValueError:
                    blank = raw_shift is None or not str(raw_shift).strip()
                    reason = ('班次缺失（空值），无法归入规定班次' if blank
                              else f'班次「{raw_shift}」不在规定班次（{"、".join(shift_field["options"])}）内')
                    quarantined.append({'line': reader.line_num, 'reason': reason,
                                        'record': {**row, 'shift': (raw_shift or '').strip()}})
                    continue
            parsed.append((reader.line_num, row))
        if version == 'v2':
            counts = Counter((row['market_id'], row['date'], row['shift']) for _, row in parsed)
            for line, row in parsed:
                key = (row['market_id'], row['date'], row['shift'])
                if counts[key] > 1:
                    quarantined.append({'line': line, 'record': dict(row),
                                        'reason': f'同一市场日班次出现 {counts[key]} 条重复记录，整组隔离待核对'})
                else:
                    rows.append(row)
        else:
            rows = [row for _, row in parsed]
    except csv.Error:
        raise ValueError(f'CSV 第 {reader.line_num} 行附近格式不正确') from None
    if not rows:
        detail = f'，{len(quarantined)} 条记录因班次问题被隔离' if quarantined else ''
        raise ValueError(f'CSV 至少需要一行有效数据{detail}')
    if version == 'v2' and hasattr(analysis, 'validate_shift_rows'):
        analysis.validate_shift_rows(rows)
    elif hasattr(analysis, 'validate_rows'):
        analysis.validate_rows(rows)
    return rows, version, quarantined


def normalize_params(params):
    fields = SPEC['params']
    if set(params) - {field['key'] for field in fields}:
        raise ValueError('存在未知运行参数，请重新打开工作面板')
    return {field['key']: cell(field, params.get(field['key'], field['default'])) for field in fields}
