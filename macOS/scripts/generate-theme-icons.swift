import Cocoa
func color(_ hex:String)->NSColor {let n=UInt64(hex.dropFirst(),radix:16) ?? 0;return NSColor(srgbRed:CGFloat((n>>16)&255)/255,green:CGFloat((n>>8)&255)/255,blue:CGFloat(n&255)/255,alpha:1)}
func rect(_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat,_ c:NSColor,_ r:CGFloat=0){c.setFill();NSBezierPath(roundedRect:NSRect(x:x,y:y,width:w,height:h),xRadius:r,yRadius:r).fill()}
func ellipse(_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ h:CGFloat,_ c:NSColor){c.setFill();NSBezierPath(ovalIn:NSRect(x:x,y:y,width:w,height:h)).fill()}
func line(_ pts:[NSPoint],_ c:NSColor,_ width:CGFloat=28,_ closed:Bool=false){let p=NSBezierPath();guard let f=pts.first else{return};p.move(to:f);for q in pts.dropFirst(){p.line(to:q)};if closed{p.close();c.setFill();p.fill()}else{p.lineWidth=width;p.lineCapStyle = .round;p.lineJoinStyle = .round;c.setStroke();p.stroke()}}
func text(_ value:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ c:NSColor){(value as NSString).draw(at:NSPoint(x:x,y:y),withAttributes:[.font:NSFont.monospacedSystemFont(ofSize:size,weight:.semibold),.foregroundColor:c])}
let rows=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [[String:Any]]
let output=URL(fileURLWithPath:CommandLine.arguments[2])
for t in rows {
 let id=t["id"] as! String;if ["collage","playful","film"].contains(id){continue}
 let a=color(t["brand"] as! String),b=color(t["second"] as! String),wash=color(t["tint"] as! String),ink=color(t["ink"] as! String),white=NSColor(srgbRed:1,green:0.995,blue:0.98,alpha:1)
 let image=NSImage(size:NSSize(width:1024,height:1024));image.lockFocus()
 let bg=NSBezierPath(roundedRect:NSRect(x:96,y:96,width:832,height:832),xRadius:id=="retro" ? 75:185,yRadius:id=="retro" ? 75:185)
 let gradient=NSGradient(starting:wash.blended(withFraction:0.20,of:.white) ?? wash,ending:wash.blended(withFraction:0.08,of:a) ?? wash)!
 gradient.draw(in:bg,angle:-70)
 switch id {
 case "press":
  rect(280,270,200,465,a,8);rect(505,270,240,390,a,8);ellipse(545,630,155,155,b);line([NSPoint(x:280,y:270),NSPoint(x:480,y:225),NSPoint(x:505,y:225),NSPoint(x:745,y:270)],a,24)
 case "acid":
  rect(96,96,832,832,color("#d1ff62"),185);let center=NSPoint(x:512,y:512)
  for i in 0..<6 {let angle=CGFloat(i)*CGFloat.pi/3;line([NSPoint(x:center.x+cos(angle)*75,y:center.y+sin(angle)*75),NSPoint(x:center.x+cos(angle)*260,y:center.y+sin(angle)*260)],a,58)}
 case "bauhaus":
  rect(96,96,832,832,color("#f5f1e7"),185);ellipse(460,490,295,295,b);rect(272,263,203,448,color("#2d66a0"));line([NSPoint(x:485,y:263),NSPoint(x:770,y:263),NSPoint(x:485,y:542)],a,0,true)
 case "candy":
  ellipse(285,262,225,225,a);ellipse(495,262,225,225,a);line([NSPoint(x:385,y:495),NSPoint(x:460,y:680),NSPoint(x:620,y:530)],color("#86aaa2"),28);ellipse(442,653,140,68,color("#a8cbb7"));ellipse(328,387,45,60,white.withAlphaComponent(0.65))
 case "terminal":
  line([NSPoint(x:265,y:360),NSPoint(x:748,y:540),NSPoint(x:775,y:598),NSPoint(x:569,y:570),NSPoint(x:500,y:760),NSPoint(x:428,y:738),NSPoint(x:438,y:526),NSPoint(x:254,y:449)],a,0,true);rect(274,253,475,28,a,14);rect(575,236,175,55,b,12)
 case "swiss":
  rect(96,96,832,832,color("#fffef9"),185);rect(408,250,208,524,a);rect(250,408,524,208,a)
 case "field":
  line([NSPoint(x:490,y:265),NSPoint(x:515,y:700)],a,24);let p=NSBezierPath();p.move(to:NSPoint(x:498,y:480));p.curve(to:NSPoint(x:295,y:680),controlPoint1:NSPoint(x:280,y:465),controlPoint2:NSPoint(x:260,y:570));p.curve(to:NSPoint(x:498,y:480),controlPoint1:NSPoint(x:470,y:735),controlPoint2:NSPoint(x:490,y:565));a.setFill();p.fill();let q=NSBezierPath();q.move(to:NSPoint(x:510,y:600));q.curve(to:NSPoint(x:740,y:780),controlPoint1:NSPoint(x:545,y:785),controlPoint2:NSPoint(x:690,y:795));q.curve(to:NSPoint(x:510,y:600),controlPoint1:NSPoint(x:765,y:610),controlPoint2:NSPoint(x:625,y:540));b.blended(withFraction:0.6,of:a)!.setFill();q.fill()
 case "workshop":
  rect(245,268,534,484,color("#283645"),48);line([NSPoint(x:331,y:592),NSPoint(x:439,y:510),NSPoint(x:331,y:428)],color("#9dd0ff"),32);rect(498,409,174,26,color("#c0d5ab"),8);for i in 0..<3{ellipse(285+CGFloat(i)*40,695,17,17,wash)}
 case "post":
  rect(242,319,540,394,white,30);line([NSPoint(x:256,y:690),NSPoint(x:512,y:480),NSPoint(x:768,y:690)],a,30);line([NSPoint(x:260,y:335),NSPoint(x:432,y:485)],a,24);line([NSPoint(x:764,y:335),NSPoint(x:592,y:485)],a,24);for i in 0..<6 {rect(285+CGFloat(i)*76,280,40,15,i%2==0 ? a:b,3)}
 case "memphis":
  ellipse(270,470,300,300,color("#89c9b8"));rect(535,260,170,285,b,24);line([NSPoint(x:278,y:340),NSPoint(x:330,y:403),NSPoint(x:381,y:340),NSPoint(x:432,y:403),NSPoint(x:483,y:340)],ink,22);ellipse(688,693,50,50,ink)
 case "retro":
  rect(242,287,540,430,color("#817f8d"));rect(257,303,510,397,white);rect(257,632,510,68,color("#c6bdd9"));rect(288,648,28,28,ink);rect(324,412,370,143,color("#a99ac6"));rect(324,540,148,56,color("#a99ac6"));rect(337,425,344,112,color("#d4c9e3"))
 case "glass":
  let circle=NSBezierPath(ovalIn:NSRect(x:252,y:263,width:455,height:455));let g=NSGradient(colors:[NSColor.white,color("#c4e8fa"),color("#a5c8eb"),color("#c8b4e5")])!;g.draw(in:circle,angle:-55);ellipse(577,240,195,195,white.withAlphaComponent(0.62));ellipse(335,540,125,125,white.withAlphaComponent(0.37))
 case "marginalia":
  line([NSPoint(x:270,y:697),NSPoint(x:465,y:697),NSPoint(x:510,y:658),NSPoint(x:555,y:697),NSPoint(x:750,y:697),NSPoint(x:750,y:310),NSPoint(x:555,y:310),NSPoint(x:510,y:270),NSPoint(x:465,y:310),NSPoint(x:270,y:310)],white,0,true);line([NSPoint(x:512,y:290),NSPoint(x:512,y:650)],ink.withAlphaComponent(0.4),12);for y in stride(from:CGFloat(400),through:610,by:70){line([NSPoint(x:318,y:y),NSPoint(x:445,y:y)],ink.withAlphaComponent(0.5),11)};line([NSPoint(x:590,y:420),NSPoint(x:702,y:473)],a,16)
 case "metro":
  line([NSPoint(x:320,y:267),NSPoint(x:320,y:650),NSPoint(x:650,y:650),NSPoint(x:650,y:768)],a,55);line([NSPoint(x:248,y:420),NSPoint(x:755,y:420)],b,45);for (x,y) in [(320,420),(320,650),(650,650)]{ellipse(CGFloat(x)-40,CGFloat(y)-40,80,80,white);ellipse(CGFloat(x)-23,CGFloat(y)-23,46,46,a)}
 case "sketch":
  for x in stride(from:CGFloat(210),through:830,by:60){for y in stride(from:CGFloat(210),through:830,by:60){ellipse(x,y,4,4,color("#c9d4be"))}};line([NSPoint(x:330,y:320),NSPoint(x:408,y:501),NSPoint(x:666,y:758),NSPoint(x:746,y:677),NSPoint(x:488,y:420)],a,0,true);line([NSPoint(x:330,y:320),NSPoint(x:488,y:420),NSPoint(x:408,y:501)],b,0,true);line([NSPoint(x:500,y:665),NSPoint(x:620,y:780)],ink.withAlphaComponent(0.2),13)
 case "racing":
  for (i,c) in [b,a,color("#d7dedc")].enumerated(){let x=CGFloat(225+i*165);line([NSPoint(x:x,y:280),NSPoint(x:x+105,y:280),NSPoint(x:x+290,y:750),NSPoint(x:x+185,y:750)],c,0,true)}
 case "gallery":
  let p=NSBezierPath(roundedRect:NSRect(x:265,y:265,width:320,height:480),xRadius:160,yRadius:160);a.withAlphaComponent(0.7).setFill();p.fill();rect(265,265,320,160,a.withAlphaComponent(0.7));ellipse(600,534,200,200,b)
 default:break
 }
 image.unlockFocus();guard let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) else{fatalError("Icon encoding")};try png.write(to:output.appendingPathComponent("theme-"+id+".png"));print("Generated "+id)
}
