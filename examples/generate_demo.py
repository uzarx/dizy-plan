"""Generate a fictional demo; no customer drawings or metadata are used."""

from pathlib import Path
import ezdxf
from ezdxf.enums import TextEntityAlignment


def build():
    doc = ezdxf.new("R2018")
    doc.units = 4
    for name, color in [
        ("A-WALL", 7),
        ("A-DOOR", 3),
        ("A-GLASS", 4),
        ("A-FURN", 8),
        ("A-TEXT", 7),
    ]:
        doc.layers.new(name, dxfattribs={"color": color})
    m = doc.modelspace()

    def rect(layout, x, y, w, h, layer):
        layout.add_lwpolyline(
            [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
            close=True,
            dxfattribs={"layer": layer},
        )

    rect(m, 0, 0, 9000, 6500, "A-WALL")
    rect(m, 180, 180, 8640, 6140, "A-WALL")
    for a, b in [
        ((5200, 180), (5200, 2500)),
        ((5200, 3400), (5200, 6320)),
        ((5380, 180), (5380, 2500)),
        ((5380, 3400), (5380, 6320)),
        ((5380, 3000), (6200, 3000)),
        ((7100, 3000), (8820, 3000)),
        ((5380, 3180), (6200, 3180)),
        ((7100, 3180), (8820, 3180)),
    ]:
        m.add_line(a, b, dxfattribs={"layer": "A-WALL"})
    m.add_arc((5200, 2500), 900, 0, 90, dxfattribs={"layer": "A-DOOR"})
    m.add_line((5200, 2500), (6100, 2500), dxfattribs={"layer": "A-DOOR"})
    for x, w in [(900, 2300), (6300, 1600)]:
        rect(m, x, 6380, w, 50, "A-GLASS")
    sofa = doc.blocks.new("DEMO_SOFA")
    rect(sofa, 0, 0, 2200, 850, "A-FURN")
    for x in (120, 790, 1460):
        rect(sofa, x, 140, 620, 590, "A-FURN")
    m.add_blockref("DEMO_SOFA", (650, 4400), dxfattribs={"layer": "A-FURN"})
    bed = doc.blocks.new("DEMO_BED")
    rect(bed, 0, 0, 1800, 2100, "A-FURN")
    rect(bed, 80, 1400, 1640, 550, "A-FURN")
    m.add_blockref("DEMO_BED", (6200, 3850), dxfattribs={"layer": "A-FURN"})
    table = doc.blocks.new("DEMO_TABLE")
    rect(table, 0, 0, 1400, 800, "A-FURN")
    for x, y in [(200, -350), (850, -350), (200, 900), (850, 900)]:
        rect(table, x, y, 350, 300, "A-FURN")
    m.add_blockref("DEMO_TABLE", (2100, 1800), dxfattribs={"layer": "A-FURN"})
    m.add_circle((1900, 3600), 450, dxfattribs={"layer": "A-FURN"})
    rect(m, 5900, 550, 2200, 650, "A-FURN")
    for x, y, label in [
        (2800, 5800, "MEHMONXONA"),
        (7100, 3500, "YOTOQXONA"),
        (7100, 2200, "OSHXONA"),
    ]:
        m.add_text(label, dxfattribs={"height": 150, "layer": "A-TEXT"}).set_placement(
            (x, y), align=TextEntityAlignment.MIDDLE_CENTER
        )
    return doc


if __name__ == "__main__":
    build().saveas(Path(__file__).with_name("demo-plan.dxf"))
