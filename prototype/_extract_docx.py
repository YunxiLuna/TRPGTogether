# -*- coding: utf-8 -*-
import sys
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

def iter_block_items(parent):
    # parent: Document._body or a cell-like element container
    for child in parent._body._element.iterchildren():
        if child.tag == qn('w:p'):
            yield Paragraph(child, parent)
        elif child.tag == qn('w:tbl'):
            yield Table(child, parent)

def dump(path, out):
    doc = Document(path)
    n_par = 0
    n_tbl = 0
    with open(out, 'w', encoding='utf-8') as f:
        for block in iter_block_items(doc):
            if isinstance(block, Paragraph):
                t = block.text.strip()
                style = block.style.name if block.style is not None else ''
                if t:
                    n_par += 1
                    if style and style.startswith('Heading'):
                        f.write(f'[{style}] {t}\n')
                    else:
                        f.write(t + '\n')
            else:
                n_tbl += 1
                f.write(f'\n=== TABLE {n_tbl} ===\n')
                for row in block.rows:
                    cells = [c.text.strip().replace('\n', ' / ') for c in row.cells]
                    f.write(' | '.join(cells) + '\n')
        f.write(f'\n--- stats: paragraphs={n_par} tables={n_tbl} ---\n')
    print(f'{path}: paragraphs={n_par} tables={n_tbl} -> {out}')

dump(r'D:\WORK\TRPGTogether\data\input\《斗罗_诸天穿越系统》(1).docx', r'D:\WORK\TRPGTogether\prototype\_doulou.txt')
dump(r'D:\WORK\TRPGTogether\data\input\修仙大千世界指令文游(1).docx', r'D:\WORK\TRPGTogether\prototype\_xiuxian.txt')
