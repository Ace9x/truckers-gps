# Generates realistic, varied sample rate cons + ground truth (fixtures for test/ratecon-e2e.mjs)
import json, random
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = letter
truth = {}
def A():
    c = canvas.Canvas('a_summit.pdf', pagesize=letter); y = H - 50
    def t(s, x=50, f='Helvetica', z=10):
        nonlocal y; c.setFont(f, z); c.drawString(x, y, s); y -= z + 5
    t('Summit Freight Brokerage, LLC', f='Helvetica-Bold', z=16); t('MC# 884213  |  1200 Market St, Philadelphia, PA 19107  |  (215) 555-0100')
    y -= 8; t('RATE CONFIRMATION', f='Helvetica-Bold', z=14); t('Load #: SFB-448812          Date Issued: 10/28/2026')
    t('Carrier: RigRoute Test Carrier          Driver: TBD'); y -= 8
    t('PICKUP', f='Helvetica-Bold', z=12); t('Hunts Point Cooperative Market'); t('355 Food Center Dr'); t('Bronx, NY 10474')
    t('Date: 11/02/2026    Time: 08:00 - 12:00'); t('Contact: Mike Tran  (718) 555-0142'); y -= 8
    t('DELIVERY', f='Helvetica-Bold', z=12); t('Port Newark Container Terminal'); t('241 Calcutta St'); t('Newark, NJ 07114')
    t('Date: 11/02/2026    Time: 14:00 - 16:00'); t('Contact: Receiving Dept  (973) 555-0199'); y -= 8
    t('Equipment: 53\' Dry Van        Commodity: Paper products        Weight: 38,500 lbs'); y -= 8
    t('CHARGES', f='Helvetica-Bold', z=12); t('Line Haul                                   $1,850.00'); t('Fuel Surcharge                              $210.00')
    t('Lumper (reimbursable with receipt)          $150.00'); t('Total Carrier Pay                           $2,210.00'); y -= 8
    t('Detention: $50.00/hr after 2 hours free time. Must be reported within 24 hours.')
    t('Special Instructions: Driver must call 1 hour before arrival. No double brokering.')
    c.save()
    truth['a_summit.pdf'] = dict(customer='Summit Freight Brokerage, LLC', ref='SFB-448812', commodity='Paper products', weight_lb=38500, vehicle='semi', equipment="53' Dry Van", rate_usd=2210, reefer_setpoint=None,
      stops=[dict(kind='pickup', name='Hunts Point Cooperative Market', address='355 Food Center Dr, Bronx, NY 10474', appt='2026-11-02T08:00', appt_end='2026-11-02T12:00', phone='(718) 555-0142'),
             dict(kind='drop', name='Port Newark Container Terminal', address='241 Calcutta St, Newark, NJ 07114', appt='2026-11-02T14:00', appt_end='2026-11-02T16:00', phone='(973) 555-0199')],
      accessorials=['fuel', 'lumper', 'detention'], detention_rate=50, detention_free_min=120, notes_has='call 1 hour before')
def B():
    c = canvas.Canvas('b_blueridge.pdf', pagesize=letter)
    c.setFont('Helvetica-Bold', 18); c.drawString(50, H - 50, 'Blue Ridge Logistics Inc.')
    c.setFont('Helvetica', 9); c.drawString(50, H - 64, '4400 Peachtree Industrial Blvd, Norcross, GA 30071  •  dispatch@blueridge.example')
    c.setFont('Helvetica-Bold', 13); c.drawRightString(W - 50, H - 50, 'CARRIER LOAD TENDER'); c.setFont('Helvetica', 10); c.drawRightString(W - 50, H - 66, 'Order No: BRL-20391')
    c.rect(45, H - 300, W - 90, 210)
    c.line(W / 2, H - 300, W / 2, H - 90)
    rows = [('SHIPPER', 'CONSIGNEE'), ('Restaurant Depot', 'Whole Foods Market Distribution'), ('1524 132nd St', '100 Metroplex Dr'), ('College Point, NY 11356', 'Edison, NJ 08817'),
            ('Pickup: Nov 3, 2026', 'Deliver: Nov 3, 2026'), ('Appt: 0700-0900', 'Appt: 1300'), ('Ref: PO 77120-A', 'Ref: DEL 5531'), ('Phone: 718-555-0177', 'Phone: 732-555-0120')]
    y = H - 108
    for i, (l, r) in enumerate(rows):
        f = 'Helvetica-Bold' if i == 0 else 'Helvetica'; c.setFont(f, 10); c.drawString(55, y, l); c.drawString(W / 2 + 10, y, r); y -= 22
    y = H - 330; c.setFont('Helvetica', 10)
    for s in ['Equipment: 53\' Reefer   Temp: 34°F continuous', 'Commodity: Fresh produce (palletized)   Pallets: 20   Weight: 42,000 lb',
              'Rate: Line haul $3,250.00   Stop off: $75.00   Fuel: included', 'TOTAL: $3,325.00', 'Detention $40/hr after 2 hrs', 'Notes: Pulp temps at pickup. Seal must be intact on arrival.']:
        c.drawString(50, y, s); y -= 18
    c.save()
    truth['b_blueridge.pdf'] = dict(customer='Blue Ridge Logistics Inc.', ref='BRL-20391', commodity='Fresh produce (palletized)', weight_lb=42000, vehicle='semi', equipment="53' Reefer", rate_usd=3325, reefer_setpoint=34,
      stops=[dict(kind='pickup', name='Restaurant Depot', address='1524 132nd St, College Point, NY 11356', appt='2026-11-03T07:00', appt_end='2026-11-03T09:00', phone='718-555-0177'),
             dict(kind='drop', name='Whole Foods Market Distribution', address='100 Metroplex Dr, Edison, NJ 08817', appt='2026-11-03T13:00', appt_end=None, phone='732-555-0120')],
      accessorials=['stop', 'detention'], detention_rate=40, detention_free_min=120, notes_has='Pulp temps')
def C():
    c = canvas.Canvas('c_hudson.pdf', pagesize=letter); y = H - 50
    def t(s, x=50, f='Times-Roman', z=11):
        nonlocal y; c.setFont(f, z); c.drawString(x, y, s); y -= z + 4
    t('HUDSON VALLEY DISPATCH CO', f='Times-Bold', z=15); t('Pro #: HV-7781    Tender date: 2026-10-28'); t('Bill To: Hudson Valley Dispatch Co, 22 Main St, Poughkeepsie, NY 12601'); y -= 6
    t('Stop 1 - Pickup', f='Times-Bold', z=12); t('Home Depot RDC'); t('400 Cabot Dr, Hamburg, PA 19526'); t('2026-11-04 09:00 to 11:00'); t('Contact: Ana Ortiz 610-555-0101'); y -= 6
    t('Stop 2 - Delivery', f='Times-Bold', z=12); t('Home Depot #1203'); t('2750 Route 22, Union, NJ 07083'); t('2026-11-04 15:30'); t('Contact: Front desk 908-555-0144'); y -= 6
    t('Stop 3 - Delivery', f='Times-Bold', z=12); t('Home Depot #1251'); t('400 Park Pl, Secaucus, NJ 07094'); t('2026-11-04 18:00 to 20:00'); t('Contact: Lee 201-555-0133'); y -= 6
    t("Equipment: 26' Box Truck w/ liftgate"); t('Commodity: Building materials'); t('Weight: 9,200 lb'); t('Agreed Rate: $1,275.00 (all-in)'); t('TONU: $150.00 if cancelled after dispatch')
    t('Comments: Liftgate required at both drops. Inside delivery at Stop 3.'); c.save()
    truth['c_hudson.pdf'] = dict(customer='Hudson Valley Dispatch Co', ref='HV-7781', commodity='Building materials', weight_lb=9200, vehicle='box', equipment="26' Box Truck w/ liftgate", rate_usd=1275, reefer_setpoint=None,
      stops=[dict(kind='pickup', name='Home Depot RDC', address='400 Cabot Dr, Hamburg, PA 19526', appt='2026-11-04T09:00', appt_end='2026-11-04T11:00', phone='610-555-0101'),
             dict(kind='drop', name='Home Depot #1203', address='2750 Route 22, Union, NJ 07083', appt='2026-11-04T15:30', appt_end=None, phone='908-555-0144'),
             dict(kind='drop', name='Home Depot #1251', address='400 Park Pl, Secaucus, NJ 07094', appt='2026-11-04T18:00', appt_end='2026-11-04T20:00', phone='201-555-0133')],
      accessorials=['tonu'], detention_rate=None, detention_free_min=None, notes_has='Liftgate required')
def D():  # scanned: image-only PDF, slight skew + noise
    img = Image.new('L', (1700, 2200), 250); d = ImageDraw.Draw(img); F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 30); FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 40)
    lines = [('Keystone Transport Brokers', FB), ('RATE CONFIRMATION', FB), ('Load Number: KTB-90215', F), ('', F), ('PICK UP', FB), ('Amazon Fulfillment Center', F), ('1 Centerpoint Blvd', F), ('Carteret, NJ 07008', F),
             ('Date: 11/05/2026  Time: 06:00 - 10:00', F), ('Contact: Shipping (732) 555-0161', F), ('', F), ('DELIVER TO', FB), ('Walmart Distribution Center', F), ('7562 Industrial Blvd', F), ('Allentown, PA 18106', F),
             ('Date: 11/05/2026  Time: 15:00', F), ('Contact: Dock 5 (610) 555-0188', F), ('', F), ("Equipment: 53' Dry Van", F), ('Commodity: General merchandise', F), ('Weight: 24,000 lbs', F), ('Total Rate: $1,480.00', F),
             ('Notes: Drop and hook at receiver.', F)]
    y = 80
    for s, f in lines: d.text((110, y), s, fill=20, font=f); y += 62 if f is FB else 52
    img = img.rotate(0.8, fillcolor=250, expand=False)
    rnd = random.Random(7); px = img.load()
    for _ in range(25000): x, yy = rnd.randrange(1700), rnd.randrange(2200); px[x, yy] = rnd.choice([60, 120, 200])
    img = img.filter(ImageFilter.GaussianBlur(0.6)); img.save('d_scan.png'); img.convert('RGB').save('d_scan.pdf', resolution=200)
    truth['d_scan.pdf'] = dict(customer='Keystone Transport Brokers', ref='KTB-90215', commodity='General merchandise', weight_lb=24000, vehicle='semi', equipment="53' Dry Van", rate_usd=1480, reefer_setpoint=None,
      stops=[dict(kind='pickup', name='Amazon Fulfillment Center', address='1 Centerpoint Blvd, Carteret, NJ 07008', appt='2026-11-05T06:00', appt_end='2026-11-05T10:00', phone='(732) 555-0161'),
             dict(kind='drop', name='Walmart Distribution Center', address='7562 Industrial Blvd, Allentown, PA 18106', appt='2026-11-05T15:00', appt_end=None, phone='(610) 555-0188')],
      accessorials=[], detention_rate=None, detention_free_min=None, notes_has='Drop and hook')
A(); B(); C(); D(); json.dump(truth, open('truth.json', 'w'), indent=1)
