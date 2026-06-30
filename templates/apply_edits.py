#!/usr/bin/env python3
"""
apply_edits.py -- 直接修改 questions.js 题库文件

用法:
  python apply_edits.py --list                    列出所有题目
  python apply_edits.py --apply edit_manifest.json  从编辑清单批量应用修改
  python apply_edits.py --id q10 --answer D        修改单题答案
  python apply_edits.py --id q10 --question "..."  修改单题题目
  python apply_edits.py --id q10 --option A "..."  修改单题选项
  python apply_edits.py --id q10 --options A:... B:... C:... D:... 批量改选项
  python apply_edits.py --id q10 --answer D --dry-run  预览不写入
"""

import re
import json
import sys
import os
import shutil
from datetime import datetime

DEFAULT_QUESTIONS_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js', 'questions.js')


def read_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def write_file(filepath, content):
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)


def find_question_block(text, q_id):
    """在文件内容中定位某个题目的起止位置。
    返回 (start_pos, end_pos) 或 (None, None)
    """
    # 匹配模式: id: "qN"
    pattern = r'(\{\s*\n\s*id:\s*"' + re.escape(q_id) + r'")'
    m = re.search(pattern, text)
    if not m:
        return None, None

    start = m.start()
    # 从 start 开始数 { } 深度
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if ch == '\\':
            esc = True
            continue
        if ch == '"' and not esc:
            in_str = not in_str
        if in_str:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                # 跳过末尾的可选逗号
                end = i + 1
                while end < len(text) and text[end] in ' \t,':
                    end += 1
                return start, end
    return start, None


def find_closing_quote(text, start):
    """给定文本中某个 " 的位置，找到配对的关闭 " """
    esc = False
    for i in range(start + 1, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if ch == '\\':
            esc = True
            continue
        if ch == '"':
            return i
    return None


def apply_edit_to_block(block, edit):
    """对单个题目的文本块应用修改"""
    result = block

    # ── 修改题目文本 ──
    if 'question' in edit and edit['question'] is not None:
        old = re.search(r'question:\s*"((?:[^"\\]|\\.)*)"', result)
        if old:
            new_q = escape_js_string(edit['question'])
            result = result[:old.start()] + 'question: "' + new_q + '"' + result[old.end():]

    # ── 修改答案 ──
    if 'answer' in edit and edit['answer'] is not None:
        ans = edit['answer']
        if isinstance(ans, list):
            ans_js = '["' + '", "'.join(ans) + '"]'
        else:
            ans_js = '"' + escape_js_string(str(ans)) + '"'
        old = re.search(r'answer:\s*(?:"(?:[^"\\]|\\.)*"|\[.*?\])', result, re.DOTALL)
        if old:
            result = result[:old.start()] + 'answer: ' + ans_js + result[old.end():]

    # ── 修改选项文本 ──
    if 'options' in edit and edit['options'] is not None:
        for opt in edit['options']:
            label = opt['label']
            new_text = escape_js_string(opt['text'])
            # 匹配 { label: "X", text: "..." }
            opt_pat = r'(\{\s*label:\s*"' + label + r'"\s*,\s*text:\s*)"((?:[^"\\]|\\.)*)"(\s*\})'
            result = re.sub(opt_pat, r'\1"' + new_text + r'"\3', result, count=1)

    return result


def escape_js_string(s):
    """转义字符串以安全放入 JS "..." 中"""
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r')


def apply_manifest(filepath, manifest_path, dry_run=False, backup=True):
    """从编辑清单 JSON 批量应用修改"""
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    edits = manifest.get('edits', {})
    if not edits:
        print('Edit manifest is empty, nothing to apply.')
        return

    print(f'Reading manifest: {manifest_path}')
    print(f'Pending edits: {len(edits)} questions\n')

    text = read_file(filepath)
    modified_count = 0

    for q_id, edit in edits.items():
        start, end = find_question_block(text, q_id)
        if start is None:
            print(f'  [SKIP] {q_id}: not found in file')
            continue

        old_block = text[start:end]
        new_block = apply_edit_to_block(old_block, edit)

        if old_block == new_block:
            print(f'  [NOCHG] {q_id}: no changes')
            continue

        text = text[:start] + new_block + text[end:]
        modified_count += 1

        # Print change summary
        changes = []
        if 'question' in edit:
            old_q = re.search(r'question:\s*"((?:[^"\\]|\\.)*)"', old_block)
            old_txt = old_q.group(1)[:40] if old_q else '?'
            new_txt = edit['question'][:40]
            if old_txt != new_txt:
                changes.append(f'question: "{old_txt}..." -> "{new_txt}..."')
        if 'answer' in edit:
            old_a = re.search(r'answer:\s*(?:"([^"]*)"|\[(.*?)\])', old_block, re.DOTALL)
            old_ans = old_a.group(1) or old_a.group(2) if old_a else '?'
            new_ans = edit['answer']
            if str(old_ans) != str(new_ans):
                changes.append(f'answer: {old_ans} -> {new_ans}')
        if 'options' in edit:
            for o in edit['options']:
                changes.append(f'option.{o["label"]}: -> "{o["text"][:30]}..."')

        print(f'  [OK] {q_id}:')
        for c in changes:
            print(f'       {c}')

    if modified_count == 0:
        print('\nNo changes to apply.')
        return

    if dry_run:
        print(f'\n[DRY-RUN] {modified_count} questions would be modified. Use --no-dry-run to write.')
        return

    if backup:
        backup_path = filepath + '.bak'
        shutil.copy2(filepath, backup_path)
        print(f'\nBackup saved: {backup_path}')

    write_file(filepath, text)
    print(f'Done. {modified_count} questions modified in {filepath}')


def apply_single_edit(filepath, q_id, question=None, answer=None, options=None, dry_run=False, backup=True):
    """应用单题修改"""
    edit = {}
    if question is not None:
        edit['question'] = question
    if answer is not None:
        edit['answer'] = list(answer) if re.match(r'^[A-D]+$', answer) else answer
    if options is not None:
        edit['options'] = options

    if not edit:
        print('Error: specify at least one modification (--question / --answer / --option / --options)')
        return

    manifest = {
        '_meta': {'generated': datetime.now().isoformat(), 'singleEdit': True},
        'edits': {q_id: edit}
    }

    tmp_path = filepath + '.tmp_manifest.json'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    try:
        apply_manifest(filepath, tmp_path, dry_run=dry_run, backup=backup)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def list_questions(filepath):
    """列出所有题目"""
    text = read_file(filepath)
    # 匹配所有 id: "qN"
    ids = re.findall(r'id:\s*"(\w+)"', text)
    if not ids:
        print('No questions found.')
        return

    print(f'{len(ids)} questions:\n')
    for q_id in sorted(ids, key=lambda x: int(re.sub(r'\D', '', x) or 0)):
        start, _ = find_question_block(text, q_id)
        if start is None:
            continue
        # 提取摘要
        block_end = min(start + 300, len(text))
        snippet = text[start:block_end]
        ch = re.search(r'chapter:\s*"(\w+)"', snippet)
        num = re.search(r'number:\s*(\d+)', snippet)
        q_txt = re.search(r'question:\s*"((?:[^"\\]|\\.)*)"', snippet)
        ans = re.search(r'answer:\s*"([^"]*)"', snippet)
        ch_str = ch.group(1) if ch else '?'
        num_str = num.group(1) if num else '?'
        q_str = (q_txt.group(1)[:60] + '...') if q_txt else '(no question)'
        ans_str = ans.group(1) if ans else '?'
        print(f'  [{q_id}] ch={ch_str} #{num_str}  {q_str}  -> {ans_str}')


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Directly modify questions.js')
    parser.add_argument('--file', default=DEFAULT_QUESTIONS_JS, help='Path to questions.js')
    parser.add_argument('--apply', help='Apply edits from manifest JSON file')
    parser.add_argument('--id', help='Question ID (e.g. q10)')
    parser.add_argument('--question', help='New question text')
    parser.add_argument('--answer', help='New correct answer')
    parser.add_argument('--option', nargs=2, metavar=('LABEL', 'TEXT'), action='append',
                        help='Modify single option (e.g. --option A "new text")')
    parser.add_argument('--options', nargs='+',
                        help='Batch modify options (e.g. --options A:text1 B:text2 C:text3 D:text4)')
    parser.add_argument('--dry-run', action='store_true', help='Preview only, no write')
    parser.add_argument('--no-backup', action='store_true', help='Skip backup')
    parser.add_argument('--list', action='store_true', help='List all questions')
    args = parser.parse_args()

    filepath = os.path.abspath(args.file)
    if not os.path.exists(filepath):
        print(f'ERROR: File not found: {filepath}')
        sys.exit(1)

    do_backup = not args.no_backup

    if args.list:
        list_questions(filepath)
        return

    if args.apply:
        apply_manifest(filepath, args.apply, dry_run=args.dry_run, backup=do_backup)
    elif args.id:
        options = None
        if args.option:
            options = [{'label': lbl, 'text': txt} for lbl, txt in args.option]
        elif args.options:
            options = []
            for item in args.options:
                parts = item.split(':', 1)
                if len(parts) == 2:
                    options.append({'label': parts[0], 'text': parts[1]})
        apply_single_edit(filepath, args.id,
                         question=args.question,
                         answer=args.answer,
                         options=options,
                         dry_run=args.dry_run,
                         backup=do_backup)
    else:
        parser.print_help()
        print('\nTip: use --list to view all questions, or --apply <manifest.json> for batch edits')


if __name__ == '__main__':
    main()
