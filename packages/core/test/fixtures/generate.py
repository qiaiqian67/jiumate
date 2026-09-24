#!/usr/bin/env python3
"""Regenerates the document fixtures under this directory.

These are real files produced by the same libraries everyone else uses to write these formats,
not hand-built approximations. That matters: a fixture assembled from my own understanding of
OOXML would only ever confirm that understanding, and the bugs worth catching are the ones where
the real world does something I did not think of — a zip whose entries are deflated rather than
stored, a slide list that disagrees with the slide filenames, a workbook whose strings live in a
shared table.

The generated files are committed, so the test suite needs nothing installed. This script is for
regenerating them, and it is deliberately not wired into any build or CI job — the Python
dependencies below are a developer's problem, not the repository's.

    python packages/core/test/fixtures/generate.py

Requires: python-docx, openpyxl, python-pptx, reportlab.
"""

import datetime
import os
import struct
import zipfile
import zlib
from io import BytesIO

from docx import Document
from docx.shared import Inches
from openpyxl import Workbook
from openpyxl.styles import Font
from pptx import Presentation
from pptx.util import Inches as PptxInches
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))


def png_bytes(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A valid solid-colour PNG, built by hand so no imaging library is needed.

    python-docx validates what it embeds, so a truncated or malformed file is rejected outright —
    which is how the first attempt at this fixture failed, and why the bytes are assembled from
    the actual chunk format rather than pasted from memory.
    """
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def write_docx() -> None:
    """A .docx with the structures mammoth has to map: headings, lists, a table, an image."""
    doc = Document()
    doc.add_heading("Quarterly Report", level=1)
    doc.add_paragraph(
        "Revenue grew across every region this quarter, with the strongest gains in "
        "the Asia-Pacific segment."
    )

    doc.add_heading("Highlights", level=2)
    for item in ["Revenue up 18% year over year", "Two new enterprise customers", "Churn held at 2.1%"]:
        doc.add_paragraph(item, style="List Bullet")

    doc.add_heading("By region", level=2)
    table = doc.add_table(rows=3, cols=3)
    table.style = "Table Grid"
    rows = [
        ["Region", "Revenue", "Growth"],
        ["APAC", "4.2M", "24%"],
        ["EMEA", "3.1M", "11%"],
    ]
    for row_index, row in enumerate(rows):
        for col_index, value in enumerate(row):
            table.cell(row_index, col_index).text = value

    # An embedded image, because "images are not extracted, and the output says so" is a claim
    # the test has to be able to check.
    png = os.path.join(HERE, ".tmp-chart.png")
    with open(png, "wb") as fh:
        fh.write(png_bytes(8, 8, (32, 96, 200)))
    doc.add_picture(png, width=Inches(1))
    os.remove(png)

    doc.save(os.path.join(HERE, "sample.docx"))


def write_xlsx() -> None:
    """A .xlsx with two named sheets, a date, and a shared-string-heavy body."""
    wb = Workbook()

    summary = wb.active
    summary.title = "Summary"
    summary.append(["Region", "Revenue", "Growth"])
    for cell in summary[1]:
        cell.font = Font(bold=True)
    summary.append(["APAC", 4200000, 0.24])
    summary.append(["EMEA", 3100000, 0.11])
    summary.append(["Americas", 5600000, 0.07])
    # A formula, so the formula-cell detection has something real to find. The value openpyxl
    # stores for it is a cached result, which is exactly the trap: a grid showing that number and
    # letting someone edit it would replace the formula with a literal.
    summary.append(["Total", "=SUM(B2:B4)", None])
    # A date, to pin the date handling: it must come back as a day, not a timestamp.
    summary.append(["Reported", datetime.date(2026, 9, 23), None])

    detail = wb.create_sheet("Detail")
    detail.append(["Account", "Owner", "Active"])
    detail.append(["Northwind", "Dana", True])
    detail.append(["Contoso", "Ravi", False])

    wb.save(os.path.join(HERE, "sample.xlsx"))


def write_pptx() -> None:
    """A .pptx whose slides are deliberately out of filename order.

    The deck is built with three slides and then reordered by rewriting `p:sldIdLst`, which is
    what PowerPoint itself does. The filenames stay as they were, so an extractor that walks
    `slide1.xml`, `slide2.xml`, ... returns the wrong order — and that is the single most likely
    way to get a deck wrong.
    """
    prs = Presentation()
    layout = prs.slide_layouts[1]  # Title and Content

    def add(title: str, bullets: list[str], notes: str) -> None:
        slide = prs.slides.add_slide(layout)
        slide.shapes.title.text = title
        body = slide.placeholders[1].text_frame
        body.text = bullets[0]
        for bullet in bullets[1:]:
            paragraph = body.add_paragraph()
            paragraph.text = bullet
        slide.notes_slide.notes_text_frame.text = notes

    add("Agenda", ["Where we are", "What changed", "What next"], "Keep this to thirty seconds.")
    add("Where we are", ["Revenue 18% up", "Churn 2.1%"], "Reference the board deck.")
    add("What next", ["Hire two engineers", "Ship the migration"], "Owners named in the appendix.")

    # Reverse the display order without touching the slide parts.
    sld_id_lst = prs.slides._sldIdLst
    ids = list(sld_id_lst)
    for element in ids:
        sld_id_lst.remove(element)
    for element in reversed(ids):
        sld_id_lst.append(element)

    prs.save(os.path.join(HERE, "sample.pptx"))


def write_pdf() -> None:
    """A two-page .pdf with text on both pages and a third page that is only an image."""
    path = os.path.join(HERE, "sample.pdf")
    c = canvas.Canvas(path, pagesize=letter)

    c.setFont("Helvetica", 14)
    c.drawString(72, 720, "Quarterly Report")
    c.setFont("Helvetica", 11)
    c.drawString(72, 700, "Revenue grew across every region this quarter.")
    c.drawString(72, 685, "The strongest gains were in the Asia-Pacific segment.")
    c.showPage()

    c.setFont("Helvetica", 14)
    c.drawString(72, 720, "Appendix")
    c.setFont("Helvetica", 11)
    c.drawString(72, 700, "Figures are unaudited and stated in US dollars.")
    c.showPage()

    # A page that is an image and nothing else: the case the extractor should report as "likely a
    # scan" rather than as an empty page. The image has to be a real XObject, not a vector rect —
    # a drawn rectangle is a path operator, and the scan detection looks for an image paint.
    image = ImageReader(BytesIO(png_bytes(64, 64, (32, 96, 200))))
    c.drawImage(image, 72, 600, width=200, height=100)
    c.showPage()
    c.save()


def write_odt() -> None:
    """A minimal but genuine .odt: a zip with a stored `mimetype` entry, as the spec requires.

    Hand-built because no ODF writer is assumed to be installed. The structure is small enough
    that building it is not the same guess as hand-building OOXML: the body is one XML file and
    the spec's one interesting rule — `mimetype` first and uncompressed — is stated outright.
    """
    content = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    office:version="1.3">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">Quarterly Report</text:h>
      <text:p>Revenue grew across every region this quarter.</text:p>
      <text:h text:outline-level="2">By region</text:h>
      <table:table table:name="Regions">
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>Region</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>Revenue</text:p></table:table-cell>
        </table:table-row>
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>APAC</text:p></table:table-cell>
          <table:table-cell office:value-type="float" office:value="4200000"><text:p>4,200,000</text:p></table:table-cell>
        </table:table-row>
      </table:table>
    </office:text>
  </office:body>
</office:document-content>
"""
    manifest = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
"""
    with zipfile.ZipFile(os.path.join(HERE, "sample.odt"), "w", zipfile.ZIP_DEFLATED) as zf:
        # Stored, not deflated, and first: the rule that makes a package recognisable.
        zf.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/vnd.oasis.opendocument.text",
            compress_type=zipfile.ZIP_STORED,
        )
        zf.writestr("META-INF/manifest.xml", manifest)
        zf.writestr("content.xml", content)


if __name__ == "__main__":
    write_docx()
    write_xlsx()
    write_pptx()
    write_pdf()
    write_odt()
    for name in sorted(os.listdir(HERE)):
        if name.startswith("sample."):
            print(f"  {name}  {os.path.getsize(os.path.join(HERE, name)):,} bytes")
