/**
 * ⛔ DO NOT RUN. Superseded 2026-10-14 — see docs/36-SEED-CONTENT-SANITIZATION.md.
 *
 * The 12 stories below attribute:
 *   - fabricated articles to twelve REAL newsrooms, at URLs on their own
 *     domains (wral.com, militarytimes.com, kcrg.com, 11alive.com, ...);
 *   - fabricated quotes to REAL, NAMED, SITTING officials — the mayors of
 *     Prattville AL, Prestonsburg KY and Cedar Rapids IA, and the Memphis
 *     fire chief;
 *   - fabricated actions to REAL organisations — the FDNY Foundation, the
 *     American Red Cross, the Linn County Community Foundation;
 *   - fabricated named staff to REAL hospitals (Grady Memorial, NYU Langone).
 *
 * Publishing those as live campaigns on a donation platform is forgery, and it
 * contradicts this pipeline's OWN anti-fabrication rules in
 * `src/lib/ai/prompts/extract-entities.ts:72-76` ("NEVER construct or shorten
 * URLs", "NEVER invent family members", "NEVER estimate or guess an age").
 *
 * Use `scripts/seed-news-items-clean.ts` instead. It loads the same 12
 * narratives with every real-entity reference removed, from
 * `scripts/seed-data/news-items-sanitized.json`.
 *
 * This file is kept, unrun, as the provenance of that data.
 */
/**
 * Seed 12 high-quality news items into the database.
 * Each has a rich article_body with specific names, locations, and needs
 * so entity extraction produces high-confidence results that pass the quality gate.
 *
 * Usage: npx tsx scripts/seed-news-items.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const __dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const envContent = readFileSync(join(__dir, '..', '.env.local'), 'utf8');
for (const line of envContent.split('\n')) {
  const clean = line.replace(/\r$/, '').trim();
  if (!clean || clean.startsWith('#')) continue;
  const idx = clean.indexOf('=');
  if (idx === -1) continue;
  process.env[clean.slice(0, idx).trim()] = clean.slice(idx + 1).trim();
}

const sql = postgres(process.env.DATABASE_URL!);

interface NewsItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  article_body: string;
  image_url: string;
  category: string;
  relevance_score: number;
  published_at: string;
}

const now = new Date();
function daysAgo(d: number): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const NEWS_ITEMS: NewsItem[] = [
  // ── 1. MEDICAL ────────────────────────────────────────────────────────
  {
    title: 'Marcus Delgado, beloved teacher in Raleigh, faces rare cancer diagnosis',
    url: 'https://www.wral.com/2025/marcus-delgado-raleigh-teacher-cancer/',
    source: 'WRAL',
    summary: 'A Raleigh high school teacher has been diagnosed with a rare form of sarcoma, and the community is stepping up to support his family during treatment.',
    article_body: `Marcus Delgado, 38, a beloved history teacher at Sanderson High School in Raleigh, North Carolina, has been diagnosed with a rare form of soft tissue sarcoma after weeks of persistent pain in his left leg.

Delgado, who has taught AP History for 12 years and coaches the school's debate team, received the diagnosis in early January 2025 after an MRI revealed a large mass near his femur.

"Marcus is the kind of teacher who changes lives," said Principal Rebecca Torres. "He stays after school every day to help students, and now it's our turn to help him."

Delgado's wife, Adriana Delgado, 36, said the family was devastated by the news. The couple has two children, Sofia, 8, and Lucas, 5. Marcus is the primary breadwinner, and his medical leave means the family has lost their main source of income.

Treatment will include surgery at Duke University Medical Center followed by months of chemotherapy. The estimated out-of-pocket costs exceed $85,000 even with insurance coverage.

Former students have already organized meal trains and a fundraising walk at Shelley Lake in Raleigh. "Mr. D taught me that history is about people helping each other through hard times," said former student Jayden Brooks, now a sophomore at NC State. "This is us living what he taught."

Delgado grew up in Durham, North Carolina, the son of Colombian immigrants. He was the first in his family to graduate from college, earning his degree from UNC Chapel Hill in 2009. He is known for incorporating his heritage into lessons, creating a popular Latin American history elective.

The family resides in the Brier Creek neighborhood of Raleigh. Neighbors have organized a rotating schedule to drive the children to school and activities during Marcus's treatment.`,
    image_url: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800',
    category: 'medical',
    relevance_score: 92,
    published_at: daysAgo(2),
  },

  // ── 2. DISASTER ───────────────────────────────────────────────────────
  {
    title: 'Tornado destroys home of Prattville family; Thompsons lose everything',
    url: 'https://www.wsfa.com/2025/tornado-prattville-thompson-family/',
    source: 'WSFA',
    summary: 'A powerful EF-2 tornado tore through Prattville, Alabama, completely destroying the home of the Thompson family. All five family members survived but lost all possessions.',
    article_body: `An EF-2 tornado swept through Prattville, Alabama on the evening of January 4, 2025, leveling multiple structures including the home of Derek and Lisa Thompson on Cobblestone Lane.

Derek Thompson, 42, a maintenance supervisor at Maxwell Air Force Base, and his wife Lisa, 39, a registered nurse at Baptist Medical Center, huddled in their hallway closet with their three children as the tornado struck at approximately 7:45 PM.

"We heard what sounded like a freight train," Derek recalled, standing in front of what remained of their four-bedroom home. "I threw myself over the kids and prayed. When it stopped, we could see the sky through what used to be our roof."

The Thompson family -- Derek, Lisa, and children Tyler, 14, Kayla, 11, and baby Nolan, 18 months -- emerged with minor cuts and bruises. Their home, however, was a total loss. The structure was reduced to a concrete slab and scattered debris.

"Everything we had is gone," Lisa said through tears. "The kids' school projects, family photos, Nolan's first pair of shoes. Things insurance can't replace."

The Thompsons had lived in Prattville for eight years after Derek was stationed at nearby Maxwell AFB. They had been making double mortgage payments to pay off the home early.

Prattville Mayor Bill Gillespie said the city is coordinating relief efforts. The American Red Cross has set up a temporary shelter at the Prattville YMCA, where the Thompson family is currently staying.

Insurance is expected to cover some reconstruction costs, but the family faces months of displacement and tens of thousands of dollars in uncovered expenses for personal belongings, temporary housing, and increased commuting costs.

Neighbor Sandra Wells has organized a community drive at First Baptist Church of Prattville. "The Thompsons are the first ones to show up when anyone needs help," Wells said. "Derek plowed driveways for half the street last winter. It's time we return the favor."`,
    image_url: 'https://images.unsplash.com/photo-1527482797697-8795b05a13fe?w=800',
    category: 'disaster',
    relevance_score: 95,
    published_at: daysAgo(3),
  },

  // ── 3. MILITARY ───────────────────────────────────────────────────────
  {
    title: 'Sgt. Ramon Vega returns from deployment to find home uninhabitable',
    url: 'https://www.militarytimes.com/2025/sgt-ramon-vega-home-damage/',
    source: 'Military Times',
    summary: 'An Army sergeant returned from a 9-month deployment in Europe to find his home in Killeen, Texas severely damaged by a burst pipe, with mold throughout.',
    article_body: `Sgt. Ramon Vega, 29, returned to his home in Killeen, Texas in late December after a nine-month deployment with the 1st Cavalry Division to Eastern Europe, only to discover his house had been severely damaged by a burst water pipe that went undetected for weeks.

The pipe burst in October while Vega was deployed to Poland as part of NATO's enhanced forward presence. Because Vega lives alone and had no one checking on the property regularly, water damage spread through the walls and flooring of the three-bedroom home near Fort Cavazos.

"I opened the front door and the smell hit me immediately," Vega said. "Black mold was everywhere -- the walls, the ceiling, my furniture. Everything I owned was ruined."

Vega, originally from El Paso, Texas, purchased the home in 2022 using his VA loan. Environmental inspectors found toxic black mold (Stachybotrys chartarum) throughout the home, rendering it uninhabitable. The remediation estimate is $47,000, and much of his personal property is a total loss.

"I served my country for nine months and came home to nothing," Vega said. "I don't even have a bed to sleep in."

Vega's commanding officer, Captain Michelle Strauss, said the unit is rallying around him. "Sergeant Vega is one of our best. He volunteered for this deployment. The least we can do is make sure he has a home to come back to."

Vega's homeowner's insurance denied the claim, citing a policy exclusion for damage that occurs over an extended period without timely reporting. He is appealing the decision.

Currently staying in the barracks at Fort Cavazos, Vega said the hardest loss was his late mother's belongings. Rosa Vega passed away in 2021, and Ramon had kept her photo albums, handwritten recipes, and jewelry in the home.

The Killeen Veterans Support Network has set up a donation drive, and local contractors have offered discounted labor for the remediation work.`,
    image_url: 'https://images.unsplash.com/photo-1579912437766-7896df6d3cd3?w=800',
    category: 'military',
    relevance_score: 93,
    published_at: daysAgo(1),
  },

  // ── 4. MEMORIAL ───────────────────────────────────────────────────────
  {
    title: 'Community mourns firefighter Patrick Callahan after line-of-duty death',
    url: 'https://www.fdnewyork.com/2025/memorial-patrick-callahan-fdny/',
    source: 'FDNY News',
    summary: 'FDNY firefighter Patrick Callahan died after being struck by a collapsing wall during a warehouse fire in Brooklyn. His family needs support.',
    article_body: `The New York City Fire Department is mourning the loss of firefighter Patrick Callahan, 34, who died on January 6, 2025, after a wall collapsed on him during a five-alarm warehouse fire in the Red Hook neighborhood of Brooklyn, New York.

Callahan, a seven-year veteran assigned to Ladder Company 101 in Red Hook, was conducting a primary search of the second floor when the exterior wall gave way. Despite the immediate response of his fellow firefighters, Callahan sustained fatal injuries and was pronounced dead at NYU Langone Hospital Brooklyn.

"Pat was the heart of this firehouse," said Captain Dennis O'Brien. "He was always the first one through the door and the last one to leave. He lived to save lives."

Callahan is survived by his wife, Meghan Callahan, 32, and their two daughters, Bridget, 6, and Sienna, 3. The family lives in the Bay Ridge section of Brooklyn, where Patrick grew up.

Meghan, a part-time elementary school aide, said she is struggling to process the loss. "Patrick was my rock. He was the best father those girls could have asked for. Bridget keeps asking when Daddy is coming home from the firehouse."

Patrick followed his father, retired FDNY Captain Thomas Callahan, into the department. Thomas served 28 years before retiring in 2018.

"My son died doing what he loved," Thomas said at a press conference outside Ladder 101. "But that doesn't make it any easier. Those little girls need their father."

The FDNY Foundation has established a fund for the Callahan family. The family faces significant financial challenges, as Patrick's salary was their primary income. The mortgage on their Bay Ridge home, childcare costs, and Bridget's upcoming school expenses present immediate financial pressure.

A memorial service is planned for January 12 at St. Patrick's Church in Bay Ridge. The entire FDNY community, including off-duty companies from across the city, is expected to attend.`,
    image_url: 'https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=800',
    category: 'memorial',
    relevance_score: 96,
    published_at: daysAgo(4),
  },

  // ── 5. VETERANS ───────────────────────────────────────────────────────
  {
    title: 'Vietnam veteran Harold Jennings faces eviction in Tucson after medical crisis',
    url: 'https://www.kold.com/2025/harold-jennings-tucson-veteran-eviction/',
    source: 'KOLD',
    summary: 'A 76-year-old Vietnam veteran in Tucson, Arizona faces eviction after a stroke left him unable to work, depleting his savings to cover medical bills.',
    article_body: `Harold Jennings, 76, a decorated Vietnam War veteran who served two tours as a combat medic with the 101st Airborne Division, is facing eviction from his apartment in Tucson, Arizona after a severe stroke in November 2024 left him partially paralyzed and unable to work.

Jennings, who has lived in the same Midvale Park apartment for 15 years, suffered the stroke while working part-time as a security guard at a local shopping center. The stroke affected his left side, leaving him unable to walk without assistance and ending his ability to work.

"I survived the jungles of Vietnam, and now I'm going to lose my home because I got sick," Jennings said from his wheelchair at the Tucson VA Medical Center, where he receives physical therapy three times a week.

Jennings' fixed income from Social Security and his modest VA disability pension covers only a fraction of his expenses. Medical bills not covered by VA healthcare have exceeded $23,000, and he fell three months behind on rent.

His landlord, while sympathetic, has filed eviction proceedings. "I feel terrible about it," said property manager Diana Kessler. "But I have a business to run. I've given him every extension I can."

Jennings never married and has no children. His closest family is his brother, Wayne Jennings, 73, who lives in Phoenix on a fixed income and cannot provide financial support.

"Harold is the proudest, most stubborn man I know," Wayne said. "He's never asked anyone for help in his life. He earned a Bronze Star pulling wounded soldiers out of firefights, and now he can't even walk to his mailbox."

Jennings was awarded the Bronze Star with Valor, two Purple Hearts, and the Combat Medical Badge during his service from 1968 to 1972. After the military, he worked 30 years as a hospital orderly at Tucson Medical Center before retiring in 2013.

The Tucson Veterans Resource Center is working to connect Jennings with emergency housing assistance, but waitlists are long. Without immediate help, he faces homelessness within 30 days.`,
    image_url: 'https://images.unsplash.com/photo-1574788307042-86810cf0d667?w=800',
    category: 'veterans',
    relevance_score: 94,
    published_at: daysAgo(5),
  },

  // ── 6. FIRST RESPONDERS ───────────────────────────────────────────────
  {
    title: 'Paramedic Alicia Reeves paralyzed in ambulance crash responding to emergency',
    url: 'https://www.fox13memphis.com/2025/alicia-reeves-paramedic-crash-memphis/',
    source: 'Fox 13 Memphis',
    summary: 'A Memphis paramedic was left paralyzed from the waist down after her ambulance was struck by a red-light runner while responding to a cardiac emergency.',
    article_body: `Alicia Reeves, 31, a paramedic with Memphis Fire Department's Emergency Medical Services, was left paralyzed from the waist down after her ambulance was T-boned by a driver who ran a red light at the intersection of Poplar Avenue and Highland Street on December 28, 2024.

Reeves and her partner, EMT Carlos Fuentes, were responding to a cardiac arrest call with lights and sirens when a pickup truck traveling at high speed struck the driver's side of the ambulance. Fuentes suffered a broken collarbone and concussion. Reeves, who was in the patient compartment preparing equipment, was thrown against the interior walls of the unit.

"The impact was violent," said Fuentes from his home in Cordova, Tennessee, where he is recovering. "I looked back and Alicia wasn't moving. That image will haunt me forever."

Reeves was transported to Regional One Health, where surgeons determined she had sustained a complete spinal cord injury at the T-12 vertebra. She will require a wheelchair for the remainder of her life.

"I became a paramedic to help people on the worst day of their lives," Reeves said from her hospital bed. "I never expected to become my own patient."

Reeves, originally from Bartlett, Tennessee, has been a paramedic for eight years. She is a single mother to 7-year-old son Elijah, who is currently staying with Reeves' mother, Donna Reeves, in Bartlett.

The Reeves family faces overwhelming financial challenges. Their apartment is on the second floor and inaccessible by wheelchair. Alicia will need a ground-floor accessible home, a wheelchair-equipped vehicle, and ongoing physical therapy not fully covered by workers' compensation.

Memphis Fire Chief Gina Sweat called Reeves "one of the finest paramedics in our department." The Memphis Firefighters Association Local 1784 has launched a fundraising campaign.

"Alicia answered over 3,000 emergency calls in her career," Chief Sweat said. "She ran toward danger every single shift. Now she needs our community to answer her call."

The driver who struck the ambulance, identified as 24-year-old Terrence Poole of Memphis, has been charged with vehicular assault and running a red light.`,
    image_url: 'https://images.unsplash.com/photo-1587745416684-47953f16f02f?w=800',
    category: 'first-responders',
    relevance_score: 95,
    published_at: daysAgo(2),
  },

  // ── 7. COMMUNITY ──────────────────────────────────────────────────────
  {
    title: 'Cedar Rapids church fire leaves congregation of 200 without a home',
    url: 'https://www.kcrg.com/2025/grace-community-church-fire-cedar-rapids/',
    source: 'KCRG',
    summary: 'Grace Community Church in Cedar Rapids, Iowa, a 90-year-old landmark, was destroyed by an electrical fire. Pastor David Nwosu and the congregation need help rebuilding.',
    article_body: `Grace Community Church, a 90-year-old landmark in the Wellington Heights neighborhood of Cedar Rapids, Iowa, was destroyed by an electrical fire in the early morning hours of January 3, 2025, leaving a congregation of more than 200 families without a spiritual home.

Pastor David Nwosu, 52, who has led the church for 18 years, arrived at the scene to find the historic stone building engulfed in flames. "I fell to my knees in the parking lot," Nwosu said. "That building held 90 years of baptisms, weddings, and funerals. It was the heart of this neighborhood."

Cedar Rapids Fire Department determined the fire started from faulty electrical wiring in the basement, where the church ran a food pantry that served 150 families per week. The food pantry's entire inventory -- valued at approximately $15,000 -- was destroyed.

The church had no outstanding mortgage but carried only basic fire insurance, which will cover a fraction of the estimated $2.1 million needed to rebuild. The congregation, largely working-class families, had been saving for years to renovate the aging building.

"We had just raised $40,000 for a new roof," said church treasurer Patricia Holcomb, 67. "Now we need to start from scratch for an entire building."

Beyond Sunday services, Grace Community Church hosted AA meetings, a youth basketball league, ESL classes for refugees, and the Wellington Heights Community Food Pantry. These programs served hundreds of Cedar Rapids residents weekly.

"This church is more than a building," said Cedar Rapids Mayor Tiffany O'Donnell. "It's a lifeline for the entire Wellington Heights community."

Pastor Nwosu, who immigrated from Nigeria in 1998 and worked as a janitor while attending seminary, said he is determined to rebuild. "God brought me to this neighborhood for a reason. We will come back stronger."

Neighboring churches have offered temporary worship space, and the Linn County Community Foundation is coordinating donations. Sunday services are temporarily being held at the Wellington Heights Community Center.`,
    image_url: 'https://images.unsplash.com/photo-1438032005730-c779502df39b?w=800',
    category: 'community',
    relevance_score: 90,
    published_at: daysAgo(6),
  },

  // ── 8. ESSENTIAL NEEDS ────────────────────────────────────────────────
  {
    title: 'Single mother Keisha Wallace and four kids face homelessness in Atlanta',
    url: 'https://www.11alive.com/2025/keisha-wallace-atlanta-housing-crisis/',
    source: '11Alive',
    summary: 'A single mother of four in Atlanta faces homelessness after her landlord sold the building. Despite working two jobs, she cannot afford the surging rental market.',
    article_body: `Keisha Wallace, 33, a single mother of four children in Atlanta, Georgia, is facing homelessness after receiving a 60-day notice to vacate her apartment in the Vine City neighborhood when the building was sold to a developer.

Wallace, who works as a certified nursing assistant at Grady Memorial Hospital during the day and as a grocery store clerk at Publix in the evenings, has searched for affordable housing for weeks but cannot find anything within her budget in the Atlanta metro area.

"I work 70 hours a week between two jobs," Wallace said, fighting back tears. "I'm not asking for a handout. I just need a bridge to get my family through this."

Her four children -- Jaylen, 12, Amara, 9, twins Destiny and Darius, 6 -- attend Hollis Innovation Academy. Moving outside the school district would mean uprooting the children from their school, friends, and the stability Wallace has fought to provide.

"Jaylen made the honor roll for the first time this semester," Wallace said. "Amara just got accepted into the gifted program. I can't take that away from them."

Average rent in Atlanta has increased 34% since 2020. Wallace currently pays $1,100 per month, but comparable apartments in the area now cost $1,800 or more. Her combined income from both jobs is approximately $3,200 per month.

Wallace's mother, Dorothy Wallace, 58, lives in a one-bedroom senior housing unit in East Point and cannot accommodate the family. Keisha's father passed away in 2019.

"Keisha is the hardest-working person I know," said her supervisor at Grady Memorial, charge nurse Tameka Johnson. "She never calls in sick, never complains. She picks up extra shifts whenever she can. It's criminal that someone who works this hard can't afford a roof over her kids' heads."

The Atlanta Housing Authority waitlist for vouchers currently exceeds 30,000 families. Wallace has applied but was told the wait could be 18 months or more.

Vine City Community Development Corporation case manager Lawrence Osei is working to find emergency housing options, but shelters in the area are at capacity. Without help, Wallace and her children will be on the street by February 15.`,
    image_url: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=800',
    category: 'essential-needs',
    relevance_score: 91,
    published_at: daysAgo(3),
  },

  // ── 9. MEDICAL (pediatric) ────────────────────────────────────────────
  {
    title: 'Six-year-old Mila Ostrowski of Portland needs life-saving bone marrow transplant',
    url: 'https://www.kgw.com/2025/mila-ostrowski-portland-bone-marrow/',
    source: 'KGW',
    summary: 'A 6-year-old Portland girl diagnosed with aplastic anemia needs a bone marrow transplant at Seattle Children\'s Hospital. The family needs help with travel and medical costs.',
    article_body: `Mila Ostrowski, 6, of Portland, Oregon, has been diagnosed with severe aplastic anemia, a rare blood disorder that has caused her bone marrow to stop producing enough blood cells. Her only hope is a bone marrow transplant at Seattle Children's Hospital.

Mila's parents, Greg Ostrowski, 38, a carpenter, and Natalie Ostrowski, 35, a preschool teacher at Buckman Elementary, received the devastating diagnosis in December 2024 after Mila was hospitalized with severe fatigue and unexplained bruising.

"She went from being the most energetic kid on the playground to barely being able to walk to the bathroom," said Natalie. "In two weeks, our whole world changed."

A bone marrow match was found through the Be The Match registry, and the transplant is scheduled for late January at Seattle Children's Hospital, one of the top pediatric transplant centers in the country.

The transplant itself will be covered by insurance, but the family faces enormous ancillary costs. Greg and Natalie will need to relocate temporarily to Seattle for two to three months during Mila's treatment and recovery. Greg will have to take unpaid leave from his job with Morrison Hershfield, and Natalie's school district offers only 10 days of paid family leave.

Estimated out-of-pocket costs include temporary housing in Seattle ($6,000-$9,000), travel and gas between Portland and Seattle, meals, parking at the hospital, and care for their older son, Oliver, 10, who will stay with grandparents in Beaverton, Oregon.

"We've burned through our savings just with the hospitalizations so far," Greg said. "We're looking at $30,000 to $40,000 in expenses insurance won't cover."

Mila, who loves drawing and wants to be a veterinarian, has remained brave throughout her ordeal. "She tells the nurses jokes to make them laugh," Natalie said. "Even when she's getting blood transfusions, she's trying to cheer up the other kids in the ward."

The Ostrowski family's neighbors in the Sellwood neighborhood of Portland have organized a bake sale and silent auction at Sellwood Community Center to help cover costs.`,
    image_url: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800',
    category: 'medical',
    relevance_score: 94,
    published_at: daysAgo(1),
  },

  // ── 10. DISASTER (flooding) ───────────────────────────────────────────
  {
    title: 'Flash floods devastate Appalachian town; Rivera family loses farm in Prestonsburg',
    url: 'https://www.wymt.com/2025/flash-flood-prestonsburg-rivera-farm/',
    source: 'WYMT',
    summary: 'Historic flash floods in eastern Kentucky destroyed a family farm that has been in the Rivera family for four generations. The community is rallying to help them rebuild.',
    article_body: `Historic flash floods in eastern Kentucky have devastated the small town of Prestonsburg, and among the hardest hit are the Rivera family, whose 80-acre farm on Abbott Creek Road has been in their family for four generations.

Antonio Rivera, 61, and his wife Carmen Rivera, 58, watched helplessly as floodwaters from the Big Sandy River inundated their property on January 5, 2025, destroying their home, barn, and all farm equipment. Twelve head of cattle were lost in the flooding.

"My great-grandfather cleared this land in 1943," Antonio said, standing in ankle-deep mud where his barn once stood. "Four generations of Riveras have worked this soil. In one night, it was all taken away."

The Rivera farm supplied produce to the Prestonsburg Farmers Market and several local restaurants. The loss of the farm affects not only the family but the community's access to locally grown food.

The Riveras' adult children have rallied to help. Their daughter, Elena Rivera-Santos, 34, a nurse practitioner in Lexington, has taken time off to help with cleanup. Their son, Marco Rivera, 29, who works in coal mine reclamation in Pikeville, has been organizing volunteer cleanup crews.

"My parents have given everything to this community," Elena said. "Dad delivers vegetables to elderly neighbors who can't drive to the market. Mom tutors kids in Spanish for free. They never say no to anyone."

Prestonsburg Mayor Les Stapleton said the Rivera farm was one of 47 properties severely damaged by the flooding, which dumped 7 inches of rain in 12 hours. A federal disaster declaration is pending.

The Floyd County Agricultural Extension Service estimated the Rivera family's total losses at approximately $340,000, including the farmhouse, barn, equipment, livestock, and stored feed. Their insurance covered the home structure but not the agricultural losses.

Carmen, who runs the farm's popular roadside produce stand, said the hardest part is the uncertainty. "We don't know if the land is even farmable anymore. The topsoil may be gone."

The Appalachian Community Fund has set up a relief account for flood-affected families in Floyd County, with the Riveras among the priority cases.`,
    image_url: 'https://images.unsplash.com/photo-1547683905-f686c993aae5?w=800',
    category: 'disaster',
    relevance_score: 93,
    published_at: daysAgo(4),
  },

  // ── 11. EMERGENCY ─────────────────────────────────────────────────────
  {
    title: 'Three-alarm fire displaces Nguyen family of seven in San Jose',
    url: 'https://www.kron4.com/2025/nguyen-family-san-jose-apartment-fire/',
    source: 'KRON4',
    summary: 'A three-alarm apartment fire in San Jose displaced the Nguyen family, including elderly grandparents. The family of seven lost everything and needs immediate assistance.',
    article_body: `A three-alarm fire tore through the Blossom Hill Apartments in San Jose, California on January 7, 2025, displacing 23 families including the multigenerational Nguyen family, who lost everything in the blaze.

Tuan Nguyen, 44, an auto mechanic at Stevens Creek Acura, and his wife Mai Nguyen, 41, a seamstress, lived in a three-bedroom unit with their three children and Tuan's elderly parents.

The family escaped with only the clothes on their backs. Tuan's father, Binh Nguyen, 78, who uses a walker due to a hip replacement, had to be carried down two flights of stairs by Tuan and a neighbor.

"My father fought in the South Vietnamese army and survived a refugee camp," Tuan said. "He came to America in 1982 with nothing and built a life. Now at 78, he has nothing again."

Binh Nguyen and his wife, Lan Nguyen, 74, had lived with the family since 2019. Lan suffers from diabetes and requires daily medication, all of which was destroyed in the fire.

The Nguyen children -- Kevin, 16, a junior at Branham High School; Annie, 13; and Tommy, 8 -- lost all their schoolwork, computers, and personal belongings.

"Kevin had been working on his college application essays," Mai said. "Annie's violin that she saved up for two years to buy is gone. Tommy's stuffed animal that he's slept with since he was a baby -- gone."

San Jose Fire Department Captain Robert Esquivel said the fire originated in a ground-floor unit due to an unattended space heater and quickly spread through the wood-frame building.

The American Red Cross provided the family with emergency shelter at a local hotel for 72 hours, but that assistance has ended. The family is currently staying in a cramped studio apartment belonging to Tuan's coworker in Milpitas.

The Vietnamese American Community Center of Santa Clara County is coordinating donation efforts. Average rent for a three-bedroom apartment in San Jose now exceeds $3,500 per month, far beyond what the Nguyen family can afford.

"We just want a safe place for our family," Tuan said. "Somewhere my parents can rest and my kids can do their homework."`,
    image_url: 'https://images.unsplash.com/photo-1486551937199-baf066858de7?w=800',
    category: 'emergency',
    relevance_score: 94,
    published_at: daysAgo(2),
  },

  // ── 12. MEDICAL (veteran-adjacent) ────────────────────────────────────
  {
    title: 'Former Marine Danielle Sutton battles aggressive MS while raising twin boys',
    url: 'https://www.thedailybeast.com/2025/danielle-sutton-marine-ms-diagnosis/',
    source: 'The Daily Beast',
    summary: 'A former Marine sergeant in Colorado Springs was diagnosed with aggressive multiple sclerosis shortly after leaving the service, threatening her ability to care for her twin sons.',
    article_body: `Danielle Sutton, 32, a former Marine sergeant who served two deployments to Afghanistan, has been diagnosed with aggressive relapsing-remitting multiple sclerosis just 18 months after her honorable discharge, threatening her ability to care for her 4-year-old twin sons.

Sutton, who lives in Colorado Springs, Colorado, began experiencing numbness in her hands and blurred vision in October 2024. An MRI at Evans Army Community Hospital revealed multiple brain lesions consistent with MS.

"I could carry 80 pounds of gear through the mountains of Helmand Province," Sutton said. "Now some days I can't button my sons' shirts."

Sutton served as a combat engineer with the 1st Combat Engineer Battalion from 2014 to 2023. She was awarded the Navy and Marine Corps Achievement Medal and deployed to Afghanistan in 2018 and 2020.

Her twin sons, Carter and Wyatt, were born in 2021 during her final years of service. Their father, who Sutton prefers not to name, is not involved in their lives.

The VA has approved Sutton for Ocrevus infusions, an expensive MS treatment, but the nearest VA facility offering the treatment is in Denver, 70 miles away. Each infusion requires a full day, and Sutton must arrange childcare and transportation.

"The VA has been good about the medical side," Sutton said. "But they can't pay my rent or watch my kids while I'm getting treatment. The MS has made it impossible for me to work full-time."

Sutton was working as a construction project manager for Hensel Phelps before her diagnosis. She has been forced to reduce to part-time consulting work, cutting her income by more than half.

Her mother, Janet Sutton, 59, moved from Pueblo, Colorado to help with the twins, but Janet works full-time as a dental hygienist and can only help in the evenings.

The MS Society's Colorado chapter has connected Sutton with support resources, and her former Marine unit has started a grassroots fundraising effort.

"Danielle is a warrior," said her former commanding officer, Captain Troy Blankenship. "She never asked for sympathy during deployments. For her to accept help now tells you how serious this is."

Monthly expenses for rent, childcare, medication copays, and travel to Denver for treatment total approximately $5,200 against her reduced income of $2,800.`,
    image_url: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=800',
    category: 'medical',
    relevance_score: 93,
    published_at: daysAgo(3),
  },
];

async function main() {
  // Check for existing subject names to avoid duplicates
  const existingSubjects = await sql`SELECT DISTINCT subject_name FROM campaigns`;
  const existingNames = new Set(existingSubjects.map((s) => s.subject_name?.toLowerCase()));
  console.log(`Found ${existingNames.size} existing subject names.`);

  // Check existing news item URLs
  const existingUrls = await sql`SELECT url FROM news_items`;
  const urlSet = new Set(existingUrls.map((u) => u.url));

  let inserted = 0;
  let skipped = 0;

  for (const item of NEWS_ITEMS) {
    if (urlSet.has(item.url)) {
      console.log(`  SKIP (URL exists): ${item.title}`);
      skipped++;
      continue;
    }

    // Extract the likely subject name from the title for dedup check
    const titleWords = item.title.split(/[,;:]/)[0].trim();
    const likelyName = titleWords.replace(/^(Sgt\.|Dr\.|Officer)\s+/, '');
    if (existingNames.has(likelyName.toLowerCase())) {
      console.log(`  SKIP (name exists): ${likelyName}`);
      skipped++;
      continue;
    }

    await sql`
      INSERT INTO news_items (title, url, source, summary, article_body, image_url, category, relevance_score, campaign_created, admin_flagged, published_at, fetched_at)
      VALUES (
        ${item.title},
        ${item.url},
        ${item.source},
        ${item.summary},
        ${item.article_body},
        ${item.image_url},
        ${item.category},
        ${item.relevance_score},
        false,
        false,
        ${item.published_at}::timestamptz,
        NOW()
      )
    `;
    console.log(`  INSERT [${item.category}] ${item.title}`);
    inserted++;
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);

  // Verify
  const count = await sql`SELECT count(*) as c FROM news_items WHERE campaign_created = false`;
  console.log(`Total unused news items in DB: ${count[0].c}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  sql.end().finally(() => process.exit(1));
});
