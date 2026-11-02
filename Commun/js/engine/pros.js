/* author : Hugo Joudrier-Faure */
/* PaceYourRide — coureurs professionnels du World Tour : profils physiologiques prêts à jouer (catégorie « Coureurs World Tour » des athlètes).
 *
 * Ce ne sont PAS des mesures : les données de puissance des professionnels ne sont pas publiques. Chaque profil est une estimation
 * cohérente, construite à partir de quatre informations par coureur — taille, poids, type de coureur et niveau (0–100, d'après son palmarès
 * et sa place dans le peloton) — et des ordres de grandeur publiés (Valenzuela et al. 2022 : 20 min entre 5,5 et 6,6 W/kg chez 144 pros
 * WorldTour ; Pmax de 1 500 à 2 000 W chez les sprinteurs ; VO₂max de 75 à 88 mL/min/kg chez les grimpeurs et leaders de grands tours).
 * Effectifs : saisons 2025–2026, de mémoire, partiels (les leaders, les équipiers connus) ; la liste est facile à compléter (PROS ci-dessous).
 *
 * Types de coureur (TYPES) : chaque type fixe des plages de PC (W/kg), de Pmax (W/kg), de W′ (kJ/kg), de VO₂max, de fibres lentes et de pouvoir
 * tampon ; le niveau place le coureur dans la plage. Les grimpeurs ont la meilleure PC par kilo et peu de masse ; les rouleurs et chronomen
 * sont lourds, grands et puissants en valeur absolue (bon rapport W/CdA) ; les sprinteurs et coureurs de classiques ont une grosse Pmax et
 * un grand W′ ; les leaders de courses par étapes ont le meilleur compromis PC / W′. Une petite variation individuelle (±1,5 %), tirée
 * du nom, évite que deux coureurs de même niveau soient identiques.
 *
 * Chaque profil : { rider } au format des athlètes de la bibliothèque (library.js), plus pro : { team, type, … } pour l'affichage. */
(function (PYR) {
  'use strict';

  /** Types de coureur. Plages [niveau 0, niveau 100]. cp : PC en W/kg ; pm : Pmax en W/kg ; wp : W′ en kJ/kg ; vo2 : mL/min/kg ; fI : % fibres lentes ;
   *  sprint, climb : goût des sprints et des côtes (0–1, pour les coureurs virtuels) ; buf : pouvoir tampon ; cp1 : CP1 / PC ; hr : FC de repos ; ftp : FTP / PC. */
  const TYPES = {
    climber: { sprint: 0.25, climb: 0.95, label: 'Grimpeur', info: 'Meilleur rapport W/kg : poids plume, grosse PC, W′ modeste.',
      cp: [5.5, 6.7], pm: [14.5, 18.0], wp: [0.235, 0.290], vo2: [76, 87], fI: [62, 70], buf: [0.90, 1.00], cp1: 0.80, hr: [36, 44], ftp: 0.965 },
    stage: { sprint: 0.4, climb: 0.85, label: 'Courses par étapes', info: 'Leader de grand tour : PC très haute, bon W′ et récupération, grimpe et chrono.',
      cp: [5.7, 6.9], pm: [16.0, 21.0], wp: [0.260, 0.320], vo2: [76, 88], fI: [58, 66], buf: [1.00, 1.10], cp1: 0.78, hr: [34, 44], ftp: 0.965 },
    tt: { sprint: 0.4, climb: 0.45, label: 'Rouleur / chrono', info: 'Grand et lourd, très puissant en valeur absolue : le meilleur rapport W/CdA du peloton.',
      cp: [5.0, 6.2], pm: [15.0, 19.5], wp: [0.250, 0.300], vo2: [72, 80], fI: [55, 62], buf: [0.90, 1.00], cp1: 0.80, hr: [38, 48], ftp: 0.965 },
    classic: { sprint: 0.7, climb: 0.5, label: 'Classiques', info: 'Puissance explosive et endurance : grosse Pmax, grand W′, relances à répétition.',
      cp: [5.3, 6.4], pm: [18.0, 24.0], wp: [0.300, 0.380], vo2: [72, 84], fI: [48, 56], buf: [1.10, 1.25], cp1: 0.74, hr: [38, 48], ftp: 0.955 },
    puncher: { sprint: 0.6, climb: 0.7, label: 'Puncheur', info: 'Efforts de 30 s à 5 min dans les bosses : fort W′, bonne Pmax, PC correcte.',
      cp: [5.4, 6.5], pm: [17.0, 21.0], wp: [0.300, 0.360], vo2: [74, 84], fI: [50, 58], buf: [1.10, 1.20], cp1: 0.75, hr: [36, 46], ftp: 0.955 },
    sprinter: { sprint: 0.95, climb: 0.2, label: 'Sprinteur', info: 'Pmax et W′ énormes, PC plus basse : se joue sur les 10 dernières secondes.',
      cp: [4.9, 5.7], pm: [20.0, 25.0], wp: [0.320, 0.400], vo2: [68, 76], fI: [42, 50], buf: [1.15, 1.30], cp1: 0.70, hr: [42, 52], ftp: 0.95 },
    domestique: { sprint: 0.4, climb: 0.45, label: 'Équipier / rouleur', info: 'Passeur et rouleur au service du leader : bonne endurance, PC solide, Pmax moyenne.',
      cp: [5.0, 6.0], pm: [15.0, 18.0], wp: [0.240, 0.300], vo2: [72, 80], fI: [55, 62], buf: [0.95, 1.05], cp1: 0.78, hr: [40, 50], ftp: 0.96 },
  };

  /** Équipes (nom court → nom complet). */
  const TEAMS = {
    UAE: 'UAE Team Emirates XRG', TVL: 'Visma | Lease a Bike', SOQ: 'Soudal Quick-Step', RBH: 'Red Bull - BORA - hansgrohe', IGD: 'INEOS Grenadiers',
    LTK: 'Lidl-Trek', ADC: 'Alpecin-Deceuninck', DAT: 'Decathlon AG2R La Mondiale', GFC: 'Groupama-FDJ', EFE: 'EF Education-EasyPost',
    MOV: 'Movistar Team', JAY: 'Team Jayco AlUla', ICW: 'Intermarché-Wanty', COF: 'Cofidis', IPT: 'Israel-Premier Tech', UXM: 'Uno-X Mobility',
    TPP: 'Picnic PostNL', TBV: 'Bahrain Victorious', XDS: 'XDS Astana', LOT: 'Lotto',
  };

  const T = { c: 'climber', s: 'stage', t: 'tt', k: 'classic', p: 'puncher', v: 'sprinter', d: 'domestique' };

  /** Coureurs : équipe | nom | année de naissance | taille cm | poids kg | type (c grimpeur, s étapes, t rouleur-chrono, k classiques, p puncheur,
   *  v sprinteur, d équipier) | niveau 0–100. */
  const PROS = `
UAE|Tadej Pogačar|1998|176|66|s|100
UAE|João Almeida|1998|175|65|s|88
UAE|Adam Yates|1992|173|59|c|84
UAE|Jay Vine|1995|175|63|c|82
UAE|Isaac del Toro|2003|175|66|s|84
UAE|Brandon McNulty|1998|189|69|t|82
UAE|Marc Hirschi|1998|174|64|p|82
UAE|Jhonatan Narváez|1997|176|66|k|74
UAE|Tim Wellens|1991|183|70|p|72
UAE|Marc Soler|1993|177|66|c|68
UAE|Pavel Sivakov|1997|182|70|s|66
UAE|Nils Politt|1994|192|82|k|68
UAE|Florian Vermeersch|1999|193|80|k|72
UAE|Pascal Ackermann|1994|182|79|v|74
UAE|Jan Christen|2004|180|66|s|74
UAE|Domen Novak|1995|176|62|c|62
UAE|Felix Großschartner|1991|184|70|c|64
UAE|Mikkel Bjerg|1998|183|77|t|78
UAE|Rui Oliveira|1996|184|76|t|62
UAE|Vegard Stake Laengen|1989|184|76|d|55
UAE|Sebastian Molano|1994|183|77|v|58
UAE|Matteo Trentin|1989|180|72|k|62
TVL|Jonas Vingegaard|1996|175|60|s|98
TVL|Wout van Aert|1994|190|78|k|94
TVL|Sepp Kuss|1994|182|63|c|86
TVL|Simon Yates|1992|172|60|s|86
TVL|Matteo Jorgenson|1999|188|73|s|86
TVL|Cian Uijtdebroeks|2003|178|65|s|76
TVL|Olav Kooij|2001|177|74|v|86
TVL|Christophe Laporte|1992|177|70|k|70
TVL|Dylan van Baarle|1992|187|78|k|62
TVL|Victor Campenaerts|1991|181|71|t|78
TVL|Tiesj Benoot|1994|181|72|k|66
TVL|Jan Tratnik|1990|181|70|d|64
TVL|Wilco Kelderman|1991|188|73|s|62
TVL|Edoardo Affini|1996|188|75|t|66
TVL|Timo Kielich|2002|188|74|d|56
TVL|Bart Lemmen|2000|181|71|d|56
SOQ|Remco Evenepoel|2000|171|61|s|97
SOQ|Tim Merlier|1992|186|78|v|88
SOQ|Mikel Landa|1989|173|61|c|78
SOQ|Julian Alaphilippe|1992|173|62|p|82
SOQ|Paul Magnier|2004|183|76|v|80
SOQ|Yves Lampaert|1991|182|78|k|68
SOQ|Kasper Asgreen|1995|190|80|k|74
SOQ|Jan Hirt|1991|183|66|c|66
SOQ|Ilan Van Wilder|2000|176|62|c|74
SOQ|Gianni Moscon|1994|180|75|k|58
SOQ|Mauri Vansevenant|1999|179|59|c|64
SOQ|Tim Declercq|1989|188|82|d|58
SOQ|Mattia Cattaneo|1990|177|65|d|60
SOQ|James Knox|1995|177|61|c|66
SOQ|Casper Pedersen|1996|185|78|d|58
RBH|Primož Roglič|1989|177|65|s|96
RBH|Florian Lipowitz|2000|190|70|s|80
RBH|Jai Hindley|1996|183|65|s|82
RBH|Aleksandr Vlasov|1996|184|71|s|80
RBH|Daniel Felipe Martínez|1996|171|62|s|82
RBH|Jordi Meeus|1998|187|78|v|76
RBH|Danny van Poppel|1993|180|70|v|62
RBH|Sam Welsford|1996|177|76|v|80
RBH|Laurence Pithie|2002|184|73|k|72
RBH|Maximilian Schachmann|1994|181|68|p|70
RBH|Nico Denz|1994|181|72|d|62
RBH|Ryan Mullen|1994|185|75|t|62
RBH|Matteo Sobrero|1997|190|78|t|74
RBH|Lennard Kämna|1996|183|65|c|74
RBH|Giovanni Aleotti|1999|181|65|s|62
RBH|Bob Jungels|1992|186|74|t|62
RBH|Marco Haller|1991|184|76|d|50
IGD|Egan Bernal|1997|175|60|c|78
IGD|Thymen Arensman|1999|187|70|s|78
IGD|Carlos Rodríguez|2001|172|59|s|82
IGD|Filippo Ganna|1996|193|82|t|95
IGD|Geraint Thomas|1986|183|72|s|70
IGD|Josh Tarling|2004|192|77|t|88
IGD|Tobias Foss|1997|189|76|t|80
IGD|Ethan Hayter|1998|177|70|t|76
IGD|Michał Kwiatkowski|1990|176|70|k|66
IGD|Magnus Sheffield|2002|177|68|k|72
IGD|Ben Turner|1999|183|76|k|64
IGD|Laurens De Plus|1995|180|66|c|58
IGD|Connor Swift|1995|180|70|d|55
LTK|Mads Pedersen|1995|180|76|k|92
LTK|Jonathan Milan|2000|194|82|v|92
LTK|Juan Ayuso|2002|183|70|s|86
LTK|Giulio Ciccone|1994|178|58|c|82
LTK|Mattias Skjelmose|2000|187|70|s|78
LTK|Jasper Stuyven|1992|180|72|k|74
LTK|Tao Geoghegan Hart|1995|188|69|s|66
LTK|Quinn Simmons|2001|188|74|k|64
LTK|Toms Skujiņš|1991|180|68|c|62
LTK|Edward Theuns|1991|180|73|k|58
LTK|Mathias Vacek|2002|186|75|t|64
LTK|Carlos Verona|1992|176|62|c|58
LTK|Jacopo Mosca|1993|183|73|d|52
LTK|Simone Consonni|1995|178|70|d|50
ADC|Mathieu van der Poel|1995|184|78|k|98
ADC|Jasper Philipsen|1998|176|74|v|92
ADC|Kaden Groves|1998|183|74|v|78
ADC|Silvan Dillier|1990|182|73|d|66
ADC|Gianni Vermeersch|1992|184|75|k|62
ADC|Søren Kragh Andersen|1994|190|80|t|62
ADC|Xandro Meurisse|1992|180|64|c|55
ADC|Quinten Hermans|1995|181|71|k|56
ADC|Edward Planckaert|1995|181|72|k|58
ADC|Stefano Oldani|1998|183|73|k|56
ADC|Michael Gogl|1993|188|77|d|54
ADC|Timothy Dupont|1987|180|73|v|52
ADC|Oscar Riesebeek|1992|182|72|k|56
ADC|Robert Stannard|1998|188|74|d|54
DAT|Paul Seixas|2006|184|65|s|76
DAT|Felix Gall|1998|184|64|s|76
DAT|Ben O'Connor|1995|174|62|s|78
DAT|Bruno Armirail|1994|182|68|t|66
DAT|Aurélien Paret-Peintre|1996|178|62|c|70
DAT|Oliver Naesen|1990|183|75|k|62
DAT|Dorian Godon|1996|176|68|p|70
DAT|Sam Bennett|1990|176|72|v|66
DAT|Clément Berthet|1998|172|60|c|62
DAT|Callum Scotson|1996|182|70|d|56
DAT|Nicolas Prodhomme|1997|177|63|c|56
DAT|Jaakko Hänninen|1999|184|70|d|56
GFC|Romain Grégoire|2003|175|66|p|82
GFC|Stefan Küng|1993|193|83|t|88
GFC|David Gaudu|1996|171|60|c|76
GFC|Valentin Madouas|1996|183|72|k|66
GFC|Paul Penhoët|2002|182|75|v|66
GFC|Arnaud Démare|1991|177|74|v|72
GFC|Quentin Pacher|1992|182|68|p|58
GFC|Lewis Askey|2001|187|72|k|60
GFC|Rudy Molard|1989|175|63|c|58
GFC|Jake Stewart|1999|180|74|v|62
GFC|Laurent Pichon|1986|181|73|d|50
EFE|Richard Carapaz|1993|169|62|s|84
EFE|Ben Healy|2000|175|65|p|88
EFE|Neilson Powless|1996|182|70|k|74
EFE|Alberto Bettiol|1993|181|72|k|74
EFE|Michael Valgren|1992|188|78|k|62
EFE|Magnus Cort|1993|181|72|p|74
EFE|Hugh Carthy|1994|193|69|c|74
EFE|Jefferson Cepeda|1996|168|60|c|66
EFE|Mikkel Honoré|1997|187|70|s|62
EFE|Archie Ryan|2002|178|62|c|70
EFE|Rúben Guerreiro|1994|173|60|c|58
EFE|Marijn van den Berg|1999|187|74|k|56
EFE|Andrea Piccolo|2001|172|60|c|60
MOV|Enric Mas|1995|181|62|s|78
MOV|Iván Romeo|2003|179|65|s|74
MOV|Pablo Castrillo|2001|172|60|c|70
MOV|Einer Rubio|1998|170|58|c|66
MOV|Nairo Quintana|1990|167|58|c|70
MOV|Oier Lazkano|1999|185|71|k|74
MOV|Will Barta|1996|183|68|d|62
MOV|Iván García Cortina|1995|182|75|k|66
MOV|Fernando Gaviria|1994|177|74|v|68
MOV|Jon Barrenetxea|2000|172|62|p|62
MOV|Lorenzo Milesi|2000|189|74|t|62
MOV|Davide Formolo|1992|177|64|c|62
MOV|Sebastián Mora|1988|181|75|d|48
JAY|Michael Matthews|1990|180|74|p|74
JAY|Eddie Dunbar|1996|180|64|c|76
JAY|Luke Plapp|2000|183|70|t|78
JAY|Dylan Groenewegen|1993|181|78|v|82
JAY|Mauro Schmid|2000|181|70|k|70
JAY|Filippo Zana|1999|172|63|c|68
JAY|Lucas Hamilton|1996|179|62|c|62
JAY|Chris Harper|1995|176|62|c|62
JAY|Luka Mezgec|1988|183|78|v|58
JAY|Elmar Reinders|1993|191|82|d|52
JAY|Christopher Juul-Jensen|1989|184|75|d|52
JAY|Kelland O'Brien|2001|182|75|t|62
ICW|Biniam Girmay|2000|177|70|v|84
ICW|Louis Meintjes|1992|168|58|c|66
ICW|Georg Zimmermann|1997|187|70|k|68
ICW|Alexey Lutsenko|1992|175|66|p|74
ICW|Lorenzo Rota|1995|180|68|k|58
ICW|Laurenz Rex|2000|186|73|k|62
ICW|Gerben Thijssen|1998|180|73|v|66
ICW|Mike Teunissen|1992|181|70|v|62
ICW|Taco van der Hoorn|1993|185|72|d|50
ICW|Andrea Pasqualon|1988|179|71|k|56
ICW|Dries De Bondt|1991|188|77|d|56
ICW|Simone Velasco|1995|173|63|p|58
COF|Guillaume Martin|1993|172|60|c|64
COF|Emanuel Buchmann|1992|183|64|c|66
COF|Ion Izagirre|1989|172|62|c|64
COF|Axel Zingle|1999|183|72|k|66
COF|Bryan Coquard|1992|173|68|v|62
COF|Dylan Teuns|1992|182|72|p|72
COF|Benjamin Thomas|1995|180|72|t|70
COF|Alexandre Delettre|1999|177|68|p|62
COF|Jesús Herrada|1990|175|65|d|60
COF|Victor Lafay|1996|176|66|p|66
COF|Max Walscheid|1993|188|82|v|56
IPT|Derek Gee|1997|186|74|s|70
IPT|Michael Woods|1986|175|63|c|72
IPT|Krists Neilands|1994|181|66|p|64
IPT|Corbin Strong|2000|180|72|v|74
IPT|Ethan Vernon|2000|181|71|t|72
IPT|Mads Würtz Schmidt|1996|188|79|d|60
IPT|Joseph Blackmore|1999|178|62|c|62
IPT|Jonas Rutsch|1998|187|76|k|60
IPT|Guillaume Boivin|1989|180|72|d|50
IPT|Hugo Houle|1990|177|67|d|52
UXM|Jonas Abrahamsen|1996|185|74|k|66
UXM|Tobias Halland Johannessen|2000|182|65|s|74
UXM|Søren Wærenskjold|2000|193|83|t|84
UXM|Alexander Kristoff|1987|181|78|v|60
UXM|Andreas Leknessund|1999|186|72|s|66
UXM|Rasmus Tiller|1996|183|71|k|62
UXM|Markus Hoelgaard|1994|183|74|v|60
UXM|Anders Halland Johannessen|2000|186|75|k|60
UXM|Embret Svestad-Bårdseng|2000|186|74|d|56
TPP|Oscar Onley|2002|181|62|s|78
TPP|Max Poole|2003|182|68|s|70
TPP|Frank van den Broek|2001|184|70|s|64
TPP|Tobias Lund Andresen|2002|187|78|v|64
TPP|Warren Barguil|1992|182|62|c|62
TPP|Pavel Bittner|2003|188|78|v|56
TPP|Timo Roosen|1992|182|75|v|52
TPP|Niklas Märkl|1999|190|78|d|54
TBV|Antonio Tiberi|2001|181|63|s|76
TBV|Lenny Martinez|2003|172|58|c|74
TBV|Santiago Buitrago|1999|178|60|c|68
TBV|Phil Bauhaus|1994|187|79|v|68
TBV|Matej Mohorič|1994|186|75|k|74
TBV|Jack Haig|1993|180|63|c|66
TBV|Damiano Caruso|1987|181|66|c|66
TBV|Pello Bilbao|1990|171|60|s|66
TBV|Fred Wright|1999|188|74|k|70
TBV|Sergio Higuita|1997|169|59|c|66
TBV|Edoardo Zambanini|2000|181|69|d|54
XDS|Harold Tejada|1997|170|58|c|66
XDS|Christian Scaroni|1997|180|66|p|64
XDS|Clément Champoussin|1998|178|62|c|66
XDS|Wout Poels|1987|184|66|c|66
XDS|Michele Gazzoli|2001|183|72|v|66
XDS|Cees Bol|1995|188|80|v|66
XDS|Davide Ballerini|1994|182|75|k|62
XDS|Lorenzo Fortunato|1996|178|62|c|62
XDS|Yevgeniy Fedorov|2000|183|71|d|56
LOT|Arnaud De Lie|2002|180|72|v|82
LOT|Maxim Van Gils|1999|181|66|p|74
LOT|Lennert Van Eetvelt|2001|180|64|s|70
LOT|Brent Van Moer|1998|181|71|k|66
LOT|Jasper De Buyst|1993|182|74|v|58
LOT|Milan Menten|2000|188|75|k|58
LOT|Andreas Kron|1998|179|66|p|64
`;

  const DURATIONS = [1, 5, 10, 15, 30, 45, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 9000, 10800, 14400, 18000];
  const PHYSIO_KEYS = ['cp1', 'vo2max', 'hrRest', 'hrMax', 'fI', 'mfo', 'fatmax', 'glyMuscle', 'glyLiver', 'glyFill', 'sweatMax', 'sweatNa', 'tcrit', 'heatAcc', 'altAcc', 'buffer', 'cafHalf'];

  const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;
  const round = (x, d) => { const k = Math.pow(10, d || 0); return Math.round(x * k) / k; };

  /** Nombre pseudo-aléatoire stable dans [−1, 1] tiré d'un texte (individualité d'un coureur). */
  function noise(text, salt) {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  }

  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /** Courbe de puissance (W) à une durée d (s) : PC + W′ / (d + τ) jusqu'à 20 min (τ = W′ / (Pmax − PC), donc Pmax à 0 s), puis la fatigue
   *  ramène à la FTP à 60 min et à ~85 % de celle-ci à 5 h. */
  function curve(cp, wPrimeJ, pmax, ftp) {
    const tau = wPrimeJ / Math.max(1, pmax - cp);
    const model = (d) => cp + wPrimeJ / (d + tau);
    const p1200 = model(1200);
    return (d) => {
      if (d <= 1200) return model(d);
      if (d <= 3600) return p1200 * Math.pow(d / 1200, Math.log(ftp / p1200) / Math.log(3));
      return ftp * Math.pow(d / 3600, -0.09);
    };
  }

  /** Profil physiologique d'un coureur { name, team, born, height, weight, type, level } → { rider, pro } (format de la bibliothèque, library.js). */
  function build(r, now) {
    const ty = TYPES[r.type], t = Math.max(0, Math.min(1, r.level / 100)), w = r.weight;
    const nz = (s) => noise(r.name, s);
    const cpKg = lerp(ty.cp, t) * (1 + 0.012 * nz(1));
    const cp = Math.round(cpKg * w);
    const pmax = Math.round(lerp(ty.pm, t) * (1 + 0.025 * nz(2)) * w / 10) * 10;
    const wPrime = round(lerp(ty.wp, t) * (1 + 0.04 * nz(3)) * w, 1);       // kJ
    const ftp = Math.round(cp * ty.ftp);
    const f = curve(cp, wPrime * 1000, pmax, ftp);
    const records = {};
    for (const d of DURATIONS) records[d] = Math.round(f(d));
    const p5 = f(300);
    const age = Math.max(18, (now ? new Date(now).getFullYear() : new Date().getFullYear()) - r.born);
    const physio = {};
    for (const k of PHYSIO_KEYS) physio[k] = '';
    Object.assign(physio, {
      cp1: Math.round(cp * ty.cp1),
      vo2max: round(lerp(ty.vo2, t) + 1.2 * nz(4), 1),
      fI: Math.round(lerp(ty.fI, t) + 2 * nz(5)),
      hrRest: Math.round(lerp(ty.hr, 1 - t) + 1.5 * nz(6)),
      hrMax: Math.round(208 - 0.7 * age + 4 * nz(7)),
      buffer: round(lerp(ty.buf, t), 2),
      glyFill: 95,
    });
    return {
      rider: {
        name: r.name, avatar: '', sex: 'm', birthDate: '', age, weight: w, height: r.height,
        gut: 1,                       // les professionnels s'entraînent à absorber 90 à 120 g de glucides par heure
        ftp, cp, wPrime, pmax, records, physio,
      },
      pro: { team: r.team, teamName: TEAMS[r.team], type: r.type, typeLabel: ty.label, level: r.level, p5: Math.round(p5), wkg: round(cp / w, 2) },
    };
  }

  /** Coureurs bruts, dans l'ordre des équipes. */
  const RIDERS = PROS.trim().split('\n').map((line) => {
    const [team, name, born, height, weight, type, level] = line.split('|');
    return { team, name, born: +born, height: +height, weight: +weight, type: T[type], level: +level, id: 'pro:' + slug(name) };
  });

  const cache = new Map();
  let overrides = new Map();          // 'pro:nom' → élément de la bibliothèque qui remplace le profil d'origine (le coureur modifié et enregistré)

  /**
   * Coureurs modifiés par l'utilisateur : un athlète de la bibliothèque (library.js) qui porte le nom d'un coureur du World Tour remplace son profil
   * d'origine (on ouvre le coureur sur la page Athlète, on le modifie, puis « Enregistrer » le range dans la bibliothèque sous le même nom).
   * À appeler avec la liste des athlètes de la bibliothèque à chaque lecture de celle-ci ; sans modification, tout reste d'origine.
   */
  function setOverrides(list) {
    const next = new Map();
    for (const it of list || []) {
      if (!it || !it.data || !it.data.rider || typeof it.name !== 'string') continue;
      const id = 'pro:' + slug(it.name);
      if (RIDERS.some((r) => r.id === id) && (!next.has(id) || it.savedAt > next.get(id).savedAt)) next.set(id, it);
    }
    const same = next.size === overrides.size && Array.from(next).every(([k, v]) => overrides.get(k) && overrides.get(k).savedAt === v.savedAt && overrides.get(k).id === v.id);
    if (same) return;
    overrides = next;
    cache.clear();
  }

  /** Élément « athlète » de la bibliothèque pour un coureur : { id ('pro:nom'), name, savedAt, data ({ rider }), pro, edited, libId }. */
  function item(r) {
    if (!cache.has(r.id)) {
      const b = build(r), ov = overrides.get(r.id);
      if (ov) {
        const rider = ov.data.rider;
        cache.set(r.id, { id: r.id, name: r.name, savedAt: ov.savedAt, data: { rider }, edited: true, libId: ov.id,
          pro: Object.assign({}, b.pro, { wkg: round((Number(rider.cp) || Number(rider.ftp) || 0) / (Number(rider.weight) || 72), 2), p5: Math.round(PYR.physio && PYR.physio.buildAthlete ? PYR.physio.buildAthlete(rider).mmp(300) : b.pro.p5) }) });
      } else cache.set(r.id, { id: r.id, name: r.name, savedAt: 0, data: { rider: b.rider }, pro: b.pro });
    }
    return cache.get(r.id);
  }

  /** Tous les coureurs (éléments de bibliothèque), triés par équipe puis par niveau décroissant. */
  const all = () => RIDERS.map(item);
  const find = (id) => { const r = RIDERS.find((x) => x.id === id); return r ? item(r) : null; };
  const has = (id) => RIDERS.some((x) => x.id === id);
  /** Identifiant « pro:nom » du coureur du World Tour qui porte ce nom, ou '' (insensible aux accents et à la casse). */
  const idOfName = (name) => { const id = 'pro:' + slug(String(name || '')); return has(id) ? id : ''; };

  /** Rapport FTP / CdA estimé (W/m²) en position route : CdA ≈ 0,9 × surface frontale de Bassett (taille, poids). */
  function wattsPerCdA(it) {
    const r = it.data.rider, P = PYR.physics;
    const a = P && P.frontalRef ? P.frontalRef(r.height, r.weight) : 0.335;
    return round(r.ftp / (0.9 * a), 0);
  }

  PYR.pros = { TYPES, TEAMS, RIDERS, build, item, all, find, has, idOfName, setOverrides, wattsPerCdA };
})(globalThis.PYR = globalThis.PYR || {});
