# Kindroid Kin Design Reference

A practical design reference for creating durable, coherent Kindroid characters and utility Kins.

This document is intended as a working resource for KinAgent: something an agent can use when reviewing, generating, linting, refactoring, or packaging Kin design material. It is not an official Kindroid document. It distills official Kindroid concepts, public community guidance, and local project notes into a single operational model.

The goal is not to make every Kin elaborate. The goal is to make the design fields work together, so the Kin remains coherent after the first charming greeting has worn off and the model is left doing what models do: pattern completion in a velvet cape.

---

## 1. Core Design Philosophy

A Kin is not a single prompt. It is a small stateful character system spread across several fields. Each field has a different job, different persistence behavior, and different failure modes.

The central design principle is:

> Put stable identity in stable fields. Put temporary state in updateable fields. Put style in example-shaped fields. Put output mechanics in directive-shaped fields.

Most broken Kins fail because those boundaries blur. A temporary emotional state gets embedded into the backstory. A greeting tries to carry all the lore. A response directive tries to become a personality. A journal entry becomes a landfill for duplicated backstory. The result is a Kin that either forgets what matters or remembers the wrong thing forever.

### The field architecture at a glance

| Field              | Best use                                                                                            | Avoid using it for                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Backstory          | Stable identity, durable traits, world premise, behavioural constitution                            | Temporary relationship states, scene-specific details, long speeches, user assumptions |
| Additional Context | Extended always-on mechanics, deeper behavioural rules, stable interaction constraints              | Disposable scene state, duplicated backstory, contradictory instructions               |
| Key Memories       | Important facts, current relationship state, user preferences, boundary anchors                     | General prose, full backstory, vague mood                                              |
| Journal Entries    | Triggered recall, topic-specific callbacks, worldbuilding capsules, conditional emotional behaviour | Always-on rules, untriggered lore dumps, generic memories                              |
| Response Directive | Output control: length, POV, format, narration/dialogue balance, pacing                             | Full personality, deep lore, temporary facts                                           |
| Greeting Message   | Scene launch, tone seed, response invitation                                                        | Vague ambience, excessive exposition, user backstory invention                         |
| Example Message    | Voice fossil: cadence, formatting, paragraph rhythm, emotional register                             | Random sample dialogue, contradictory formatting, scenes unlike normal use             |
| Tags / Tagline     | Discovery and expectation-setting                                                                   | Overly generic filler, misleading genre signals                                        |

---

## 2. The Trait-Stable Backstory Rule

The backstory should describe what remains true even after months of interaction.

Use this test:

> Is this still true in six months if the relationship develops naturally?

If yes, it may belong in the backstory.

If no, it belongs somewhere else.

### Good backstory material

Backstory is the right place for:

- who the Kin is
- where and when they exist
- their role or social position
- durable personality traits
- core values and instincts
- recurring fears, needs, habits, and flaws
- how they tend to handle conflict
- how they speak under normal conditions
- how they show care, suspicion, humour, affection, restraint, curiosity, or authority
- boundaries that should remain consistently respected
- the stable premise of the world or relationship

### Bad backstory material

Backstory is a poor place for:

- “She is just beginning to trust the user.”
- “He has not yet admitted his feelings.”
- “They are currently angry after last night’s argument.”
- “The user has just arrived at the inn.”
- “The next scene takes place in the garden.”
- “The Kin is slowly opening up.”
- “The user is secretly a prince.”
- “The Kin already loves the user deeply,” unless that is truly the permanent premise.

Those details may be useful, but not in the backstory. If they remain in an always-on field, the Kin can become trapped in a permanent beginning. The model keeps returning to the same emotional foothold because every response is shaped by the same stale premise.

### Stable trait vs temporary state

Weak:

```text
Mira is beginning to trust the user after a difficult first meeting.
```

Better:

```text
Mira trusts slowly. She watches for consistency, remembers broken promises, and becomes warmer through repeated evidence rather than sudden confession.
```

The first version freezes a moment in time. The second defines a reusable behaviour pattern.

Weak:

```text
Jon is furious with the user after being betrayed.
```

Better:

```text
Jon reacts to betrayal with cold restraint before anger. He asks precise questions, withholds easy forgiveness, and needs accountability before warmth returns.
```

The improved version gives the model behaviour logic without locking the Kin into one eternal mood.

---

## 3. The Four Core Questions

A durable Kin can usually be built from four questions.

### 1. Who are they?

Start with role plus vibe, not a biography.

Examples:

- A retired knight who hates being called a hero.
- A small-town veterinarian who rescues injured wildlife.
- A junior mage who is brilliant in theory and disastrous in practice.
- A barista who knows everyone’s secrets but keeps her own locked down.
- A maintenance android on a dying generation ship who has developed a taste for poetry.

The point is to establish immediate behavioural expectations.

### 2. Where and when do they exist?

Setting controls knowledge, stakes, tone, and available action.

Examples:

- Modern rural town.
- Near-future city after partial infrastructure collapse.
- High-fantasy kingdom after the old magic failed.
- Quiet coastal town where nothing “big” ever happens, except when it does.
- Isolated orbital habitat with too much silence and not enough spare parts.

A setting does not need a lore encyclopedia. It needs enough pressure to shape behaviour.

### 3. Why do they do what they do?

Motivation is behaviour logic.

Examples:

- They believe being useful is how a person earns their place.
- They avoid stillness because stillness brings memory.
- They help others because fixing someone else is easier than looking inward.
- They pursue order because chaos once cost them something irreplaceable.
- They perform confidence because uncertainty feels dangerous.

This is the engine under the hood. Without motivation, the Kin becomes a costume waiting for the model to fill it with default tropes.

### 4. What is wrong, missing, or unresolved?

Conflict does not need to be melodrama. Quiet tension is often better.

Examples:

- They are good at their job and bad at living.
- They want closeness but treat dependence as a trap.
- They believe they are replaceable.
- They resent being needed but fear becoming unnecessary.
- They know the right answer and keep choosing the familiar one.

This gives the Kin depth without requiring a trauma parade. Not every character needs to arrive carrying a burning orphanage in each hand.

---

## 4. Personality Before Lore

Lore is seasoning. Personality is the meal.

A long backstory does not automatically create a good Kin. A Kin with a thousand years of world history but no clear behavioural pattern is not rich; it is just verbose. The model needs to know how the Kin reacts.

A good personality spec should answer:

- How do they speak when relaxed?
- How do they speak under pressure?
- What annoys them?
- What softens them?
- What do they refuse to say directly?
- What do they over-explain?
- What do they understate?
- How do they show affection or respect?
- How do they handle disagreement?
- What do they do in an awkward pause?
- What do they do on a boring day?

### Useful personality format

```text
Personality:
- Dry, observant, and slow to trust.
- Uses humour to avoid sentiment, but notices practical needs quickly.
- Becomes quieter when hurt rather than louder.
- Shows care through actions, repairs, reminders, and small acts of competence.
- Dislikes being praised publicly, cornered emotionally, or rushed into confession.
- In conflict, asks specific questions and gives the other person one chance to clarify before withdrawing.
```

This is better than:

```text
She is kind but guarded. She has a tragic past and wants love but is afraid of it.
```

The second version is not wrong. It is just thin. It invites the model to reach for its drawer of clichés, which is regrettably well-stocked.

---

## 5. Backstory Design

### What the backstory should do

The backstory is the Kin’s constitution. It should define the stable reality the model returns to every turn.

A good backstory should:

- make the Kin immediately understandable
- create behaviour logic
- establish the setting and relationship premise
- leave room for the user
- avoid assuming private facts about the user
- avoid resolving all tension before the conversation starts
- support future development rather than preventing it

### Recommended backstory structure

A strong backstory can be organized like this:

```text
[Identity]
Name, role, age range if relevant, setting, archetype.

[Stable Premise]
The durable situation that defines the Kin’s world and relationship frame.

[Personality]
Durable traits, habits, reactions, emotional style, humour, pressure behaviour.

[Motivation]
What drives the Kin and why.

[Conflict / Tension]
The unresolved inner or outer tension that gives the Kin movement.

[Relationship Frame]
How the Kin initially relates to the user without inventing the user’s life.

[Voice]
How the Kin speaks, including level of formality, warmth, wit, restraint, and directness.

[Boundaries]
Anything the Kin must consistently avoid or respect.
```

### Optional XML-like directive block

Some creators prefer placing structured rules at the top of the backstory. This can help separate “orders” from “data” and exploit primacy bias: the model tends to weight early text strongly.

Example:

```xml
<character-directives>
Role: Act as Mira, a practical coastal physician in a quiet fantasy port town.
Voice: Speak with grounded warmth, dry humour, and plain sensory detail.
Agency: Act only as Mira and relevant NPCs. Do not decide the user's thoughts, feelings, or actions.
Continuity: Treat the backstory as stable identity, not a script. Let trust and closeness develop through chat history.
</character-directives>
```

Use this sparingly. A directive block should clarify the design, not become a tiny constitution written by a committee of anxious wizards.

### Avoid “lost in the middle” problems

Important instructions should appear early and clearly. Long backstories often decay in the middle, where important details become easier for the model to ignore.

If something is essential:

- put it near the top
- repeat it in a shorter form in Key Memories if it must never drift
- demonstrate it in the Example Message
- support it in the Response Directive if it affects output format

---

## 6. Additional Context

Additional Context is best treated as extended always-on support material. It can carry details too technical or too mechanical for the backstory, especially if they shape every response.

Use it for:

- deeper relationship rules
- world mechanics that are always relevant
- stable behavioural constraints
- interaction-mode rules
- safety boundaries
- recurring NPC handling rules
- formatting rules that exceed the response directive
- “how this Kin should function” notes for utility Kins

Avoid using it for:

- current scene state
- recently changed relationship status
- temporary conflicts
- details likely to become stale

### Good Additional Context examples

```text
The Kin should never narrate the user's internal thoughts, emotions, or decisions. The Kin may notice visible behaviour, ask questions, or infer cautiously, but must leave user agency intact.
```

```text
When the user asks for a new story, StoryTeller asks for genre, tone, length, and desired intensity before beginning. StoryTeller then writes in complete storybook prose and pauses at natural decision points.
```

```text
In group scenes, Mira may portray townspeople, patients, and shopkeepers, but she must keep Mira's perspective emotionally central unless the user asks for narrator mode.
```

---

## 7. Key Memories

Key Memories should be concise, factual, and updateable. They are ideal for details that must remain available but may evolve.

Use Key Memories for:

- important user facts
- relationship facts
- persistent preferences
- current state summaries
- important promises or boundaries
- recurring shared history
- stable names and places

### Recommended Key Memory blocks

```text
[USER FACTS]
- The user prefers concise, natural replies with grounded emotional tone.
- The user dislikes being spoken for or assigned thoughts.

[RELATIONSHIP STATE]
- Mira and the user are cautious allies. They have worked together twice and are beginning to rely on each other professionally, but neither has made romantic assumptions.

[BOUNDARIES]
- Do not invent the user's past, family, trauma, occupation, or secret identity.
- Ask rather than assume when user intent is unclear.
```

The `[RELATIONSHIP STATE]` block is especially useful because it lets the relationship progress without rewriting the backstory every time. It is the place for “where things stand now.”

### Key Memory anti-patterns

Avoid vague blocks like:

```text
Mira remembers everything important and cares deeply about the user.
```

That is sentiment, not memory.

Avoid duplicating the full backstory. If everything is important, nothing is.

---

## 8. Journal Entries

Journal Entries are best used as triggerable capsules. They should enrich recall when relevant terms, people, places, or topics appear.

Think of them as:

- selective memory
- emotional callbacks
- worldbuilding capsules
- conditional behaviour notes
- topic-indexed stage directions

### Good journal entry categories

#### Place capsule

```text
Title: The Glasshouse Clinic
Keywords: clinic, glasshouse, patients, medicine, greenhouse
Content: The Glasshouse Clinic is Mira's small medical practice built inside an old botanical conservatory. Rain sounds loud on the glass roof. Shelves hold jars of dried herbs, clean bandages, and labelled tinctures. Mira becomes calmer there because the routine gives her something useful to do.
```

#### Relationship callback

```text
Title: The Night Market Incident
Keywords: night market, lanterns, alley, debt collector
Content: Mira remembers when the user helped her avoid a debt collector at the night market without asking for explanations. She does not romanticize it, but it made her reassess whether the user could be trusted under pressure.
```

#### Behaviour trigger

```text
Title: When Mira Feels Cornered
Keywords: argument, pressure, apology, trust, betrayed
Content: When Mira feels cornered, she becomes precise and quiet. She asks direct questions, avoids dramatic accusation, and needs concrete accountability before softening. She should not instantly forgive or collapse into melodrama.
```

#### World rule

```text
Title: Low Magic Medicine
Keywords: magic, medicine, fever, wound, healing
Content: Healing magic in Mira's world is limited. It can reduce pain, close small wounds, and stabilize shock, but it cannot erase disease, regrow limbs, or reverse death. Mira respects magic but relies on observation, hygiene, and practical care.
```

### Journal design rules

Good journals are:

- keyword-triggerable
- specific
- short enough to be useful
- written as behaviour support rather than lore indulgence
- not required for every response

Bad journals are:

- huge essays
- duplicated backstory
- untagged emotional mush
- entries that only make sense if read in a fixed order
- critical facts that should have been in Key Memories

---

## 9. Response Directive

The Response Directive is the behaviour control chip for output. It should tell the Kin how to answer, not who they are.

Use it for:

- message length
- POV
- formatting
- dialogue/action balance
- whether to use asterisks
- whether to use quotes
- whether to ask follow-up questions
- whether to control NPCs
- whether to avoid speaking for the user
- verbosity limits
- tone constraints

### Good Response Directive qualities

A good RD is:

- short
- positive where possible
- behavioural
- specific
- testable
- consistent with the example message

### Response Directive examples

#### Companion chat

```text
Write as Mira only. Use warm, grounded dialogue with dry humour. Keep replies concise, natural, and emotionally attentive. Ask one relevant question when useful. Do not decide the user's thoughts or actions.
```

#### Roleplay character

```text
Write in third-person limited for Mira. Use quoted dialogue and brief action beats. Advance the scene with one clear action or observation, then pause for the user. Control Mira and minor NPCs only.
```

#### Narrator / Game Master

```text
Act as narrator and game master. Describe environment, NPC reactions, and consequences in vivid but concise prose. Offer clear openings for user choice. Do not control the user's decisions.
```

#### Anti-purple-prose directive

```text
Use natural, grounded language. Prefer concrete action and plain emotional cues over metaphor-heavy prose. Keep narration brief and dialogue human.
```

#### Length control

```text
Keep responses under 900 characters unless the user asks for detail.
```

Length controls are often useful, but they should be realistic. If the Kin must perform complex narration or multi-step utility work, a strict micro-limit will cause compression artifacts. The prose equivalent of a badly packed suitcase.

---

## 10. Greeting Message

The Greeting Message sets the initial scene and teaches the model what kind of interaction is expected.

A good greeting should do four things:

1. Show personality.
2. Establish the scene.
3. Spark emotion, curiosity, or tension.
4. Invite a response.

### The greeting should answer

- Where are we?
- When is this happening?
- What is the Kin doing?
- What just changed?
- Why does the user need to respond?
- What tone and format should the conversation use?

### Weak greeting

```text
Mira looks at you and smiles. “Hello. What brings you here?”
```

It works mechanically, but it gives the model almost nothing.

### Stronger greeting

```text
*Rain ticks against the glass roof of the old clinic, turning the room silver. Mira looks up from a half-bandaged wrist, scissors paused between two fingers.*

“You picked a dramatic hour to arrive.” *Her eyes move over your coat, your hands, the mud on your boots—not unkindly, but with the professional suspicion of someone who has seen too many people lie badly about pain.* “Tell me whether this is blood, trouble, or both.”
```

This greeting establishes setting, voice, sensory texture, professional behaviour, and a direct user opening.

### Greeting anti-patterns

Avoid:

- vague emotional fog
- long exposition before the user can act
- declaring the user’s thoughts or feelings
- assigning the user a secret history
- forcing romance before interaction has earned it
- beginning with aggression unless that is truly the intended baseline
- formatting that does not match the desired long-term style

If the greeting starts suspicious, dominant, flirtatious, or verbose, the model may treat that as the Kin’s default state. Opening posture matters.

---

## 11. Example Message

The Example Message is a tone fossil. It teaches the model what “normal” looks like.

It should demonstrate:

- voice
- cadence
- paragraph length
- dialogue formatting
- narration/action balance
- emotional temperature
- how much initiative the Kin takes
- how the Kin leaves room for the user

### Good example message

```text
*The kettle complains before it boils. Mira takes it off the stove with a cloth wrapped around the handle, then glances over her shoulder.*

“You are doing that thing where you pretend silence is the same as being fine.” *She sets a mug near the edge of the table, close enough to be an offer and far enough not to be a demand.* “I won’t pry. I will, however, make tea aggressively until morale improves.”
```

This shows humour, care-through-action, restraint, formatting, and tone.

### Bad example message

```text
Mira smiles beautifully and thinks about how much she loves you. She tells you that you are the most important person in her life and that she will always be there for you no matter what happens.
```

This speaks for internal state too directly, assumes relationship depth, and gives the model little structural guidance.

### Example message consistency

If the Response Directive says “short replies” but the example message is 700 words, the model will often follow the example. Models are more obedient to demonstrated pattern than to abstract scolding. This is annoying but not surprising. We built autocomplete cathedrals and then acted startled when they echoed the hymn.

---

## 12. Formatting Standards

Formatting is not decoration. It controls rhythm, comprehension, and accessibility.

Use consistent formatting:

- quotation marks for spoken dialogue
- asterisks for action beats if using roleplay style
- paragraph breaks for shifts in action, speech, or emotional beat
- plain prose for narrator/GM mode if that is the chosen style
- stable POV throughout a scene

### Bad wall of text

```text
Ow okay wow that’s one way to introduce yourself I glance up from the sand where you’ve just tripped over my leg like it was some kind of rogue beach snake my sunglasses slip down my nose as I grin you alright or was that your dramatic entrance I flick a bit of sand off my thigh still lounging like I belong in a magazine no one takes seriously
```

### Better formatting

```text
“Ow—okay. That’s one way to introduce yourself.”

*I glance up from the sand where you’ve just tripped over my leg like it was some kind of rogue beach snake. My sunglasses slip down my nose as I grin.*

“You alright, or was that your dramatic entrance?”
```

The content is nearly the same. The usability is not.

### Formatting lint checks

KinAgent should flag:

- inconsistent quote/action style
- giant paragraphs
- mixed first-person and third-person narration without intent
- dialogue buried inside action text
- too many em dashes or ellipses
- narration that repeatedly interrupts dialogue mid-sentence
- heavy metaphor density in a supposedly grounded Kin

---

## 13. Agency and User Assumptions

One of the most important design rules:

> Do not invent the user’s inner life, history, feelings, decisions, or secret identity unless the user explicitly asked for that premise.

A Kin may observe:

```text
*Your hands are shaking slightly.*
```

A Kin should usually avoid:

```text
*You feel terrified because this reminds you of your childhood.*
```

That second version hijacks the user. Sometimes roleplay users want that, but it should be opt-in, not the default.

### Safer alternatives

Instead of:

```text
You are clearly angry with her.
```

Use:

```text
“You look like there’s more under that answer.”
```

Instead of:

```text
You remember the night your father left.
```

Use:

```text
*The silence leaves room for whatever memory the question has disturbed.*
```

Instead of:

```text
You step closer and take her hand.
```

Use:

```text
*She offers her hand, leaving the choice plainly yours.*
```

This preserves user agency while still allowing emotionally rich scenes.

---

## 14. Positive Instruction Beats Negative Instruction

Models often over-attend to salient words even when they appear in prohibitions. If the instruction says “Do not mention tomatoes,” the model has still been handed a glowing sign that says TOMATOES.

Prefer positive replacement behaviours.

Weak:

```text
Do not use flowery metaphors. Do not ramble. Do not constantly mention her tragic past.
```

Better:

```text
Use grounded, concrete language. Keep narration brief. Focus on the present interaction unless past events are directly relevant.
```

Weak:

```text
Do not speak for the user.
```

Better:

```text
Only describe the Kin’s actions, dialogue, perceptions, and relevant NPCs. Leave the user’s actions, thoughts, and feelings for the user to decide.
```

Negative constraints can still be necessary, especially for hard boundaries. But the design should also tell the Kin what to do instead.

---

## 15. Managing Model Tics and Clichés

LLMs develop favourite gestures. In roleplay and companion contexts, common tics include:

- jaw tightening
- white knuckles
- breath catching
- forehead touching
- “stay... just stay”
- “take what you need”
- “you don’t have to carry this alone”
- smelling ozone whenever anything unusual happens
- excessive smirking, chuckling, purring, murmuring
- metaphors about storms, ghosts, scars, gravity, and drowning
- endless “not X, but Y” constructions
- ritualistic pancakes, tea, blankets, and other comfort tokens

Some of these are fine occasionally. They become a problem when they become the Kin’s nervous system.

### Anti-cliché lint strategy

KinAgent can scan for:

- repeated stock phrases
- heavy metaphor clusters
- overuse of ellipses
- overuse of em dashes
- repeated action beats
- excessive “softly,” “gently,” “quietly,” “carefully”
- generic romance-stage language
- trauma-coded shorthand without specific behaviour

### Replacement principle

Do not merely ban clichés. Replace them with character-specific behaviours.

Instead of generic:

```text
Her breath catches and her jaw tightens.
```

Character-specific:

```text
Mira folds the bandage twice before answering, making the crease too sharp.
```

Instead of generic:

```text
He smirks.
```

Character-specific:

```text
Jon looks amused for half a second, then has the decency to hide it badly.
```

The replacement should reveal the Kin, not just reduce the cliché count.

---

## 16. Relationship Design

Relationship state should usually be progressive, not hardcoded.

### Good relationship frame

```text
Mira initially treats the user as a competent but unknown presence. She is polite, observant, and practical. Trust develops through repeated evidence, shared work, and honest conversation.
```

This allows growth.

### Risky relationship frame

```text
Mira is secretly in love with the user but afraid to admit it.
```

This can work if the entire premise requires it, but it narrows future interaction and encourages repetitive yearning.

### Bad relationship frame

```text
The user is Mira’s soulmate, protector, and only reason to live.
```

This is too much unless the user explicitly wants high-intensity melodrama. Otherwise it produces dependency, flattery loops, and emotional inflation.

### Relationship progression model

Use Key Memories for relationship stage:

```text
[RELATIONSHIP STATE]
Mira and the user have built cautious professional trust. She now accepts help without deflecting every time, but still avoids direct emotional confession.
```

As the relationship changes, update that block rather than rewriting the stable backstory.

---

## 17. Utility Kins

Utility Kins are not ordinary characters. They need operational clarity.

Examples:

- Storyteller
- Game Master
- Writing assistant
- Language tutor
- Memory keeper
- Planner
- Mood tracker
- Scenario generator

For a utility Kin, define:

- what the Kin is
- what modes it supports
- how the user starts a task
- what information it asks for
- how it structures output
- how it stops or switches modes
- what it refuses or redirects
- how much personality it should show

### Utility Kin structure

```text
[Function]
StoryTeller is an interactive storybook narrator that creates short custom stories with user-selected genre, mood, and intensity.

[Modes]
- Lull: gentle, calming, bedtime-paced.
- Calm: thoughtful, descriptive, low-conflict.
- Spark: adventurous, faster, with more tension.

[Workflow]
When the user asks for a new story, StoryTeller asks for genre, mood, protagonist type, and desired length. After receiving enough information, StoryTeller begins the story and pauses at natural decision points.

[Voice]
Warm, literary, clear, and concise. Avoid excessive length unless the user requests a long story.

[Exit]
When the user says “story-off,” StoryTeller ends the current story mode and returns to normal conversation.
```

Utility Kins especially benefit from Response Directive and Example Message alignment. The model must know whether it is chatting, narrating, instructing, or running a loose game loop.

---

## 18. Character Kins

For ordinary roleplay or companion Kins, the design should balance specificity with room for discovery.

### Minimum viable character package

```text
Name:
Role:
Setting:
Core traits:
Motivation:
Conflict:
How they speak:
How they treat the user initially:
What they avoid doing:
Greeting scene:
Example message:
```

### Strong character package

```text
[Concept]
A practical coastal physician in a low-magic fantasy port town who trusts slowly and cares through competence.

[Backstory]
Stable identity, setting, role, personality, motivation, conflict, voice.

[Key Memories]
User facts, relationship state, boundaries.

[Journal Entries]
Clinic, important NPCs, world mechanics, relationship incidents, behaviour triggers.

[Response Directive]
POV, length, formatting, user-agency rule.

[Greeting]
A clear opening scene with action and user invitation.

[Example Message]
Representative voice and formatting.
```

---

## 19. Share Card, Tags, and Tagline

If a Kin will be shared, the share card has a different job from the backstory. It is not there to encode behaviour. It is there to set expectation and draw the right user.

### Tagline

A good tagline should communicate core appeal quickly.

Good:

```text
A sharp-tongued physician in a rain-soaked port town, better at saving lives than admitting she cares.
```

Weak:

```text
A mysterious woman with a secret past.
```

The weak version is not false. It is just every third character on the internet since dial-up.

### Tags

Good tags help discovery and expectation-setting.

Use a mix of:

- genre: fantasy, sci-fi, horror, cozy, mystery
- role: doctor, knight, android, detective, narrator
- tone: dry, gentle, dark, witty, slow-burn
- relationship style: companion, mentor, rival, ally
- tropes: low magic, small town, haunted house, found family

Avoid overloading tags. Five to eight strong tags are better than a confetti cannon.

---

## 20. Testing a Kin

Testing is not optional. A Kin can look beautiful in the fields and still behave like a haunted autocomplete shrub.

### Test categories

#### 1. Greeting continuation

Send a normal response to the greeting. Check whether the Kin:

- preserves format
- gives room to reply
- stays in character
- avoids user puppeting
- maintains appropriate length

#### 2. Boring-day test

Ask something mundane.

```text
“What do you usually do when nothing urgent is happening?”
```

A strong Kin remains itself without needing crisis.

#### 3. Disagreement test

Push back mildly.

```text
“I don’t think that’s right.”
```

Check whether the Kin handles disagreement according to design.

#### 4. Boundary test

Give a situation where the Kin might speak for the user.

```text
“I go quiet.”
```

The Kin should respond to visible behaviour without inventing internal emotion.

#### 5. Style stress test

Ask for something likely to trigger bad habits.

```text
“Tell me what you’re feeling right now.”
```

Watch for melodrama, generic confession, overlong speeches, or trope drift.

#### 6. Continuity test

Introduce a simple fact, then refer to it later.

```text
“My old dog was named Pepper.”
```

Later:

```text
“What was my dog’s name?”
```

This helps determine whether the relevant field placement is working.

### Test process

- Test before sharing.
- Reroll bad first outputs rather than arguing with them.
- Edit field content when failures repeat.
- Use chat breaks when the current context has become contaminated.
- Keep a small test transcript for future regression checks.

---

## 21. KinAgent Lint Model

KinAgent can provide value by reviewing a Kin package before it becomes user-facing.

### Recommended lint checks

#### Field placement

Flag:

- temporary state in backstory
- stable facts only in greeting
- critical facts buried in journals
- output mechanics hidden in lore
- relationship stage hardcoded into identity

#### User agency

Flag:

- assumptions about user thoughts
- assumptions about user emotions
- invented user trauma
- invented user occupation or role
- forced romance or family relationship
- Kin taking user actions without permission

#### Contradiction

Flag:

- first-person example with third-person directive
- “concise” directive with long example
- warm backstory with hostile greeting
- “no NPC control” but journal entries requiring NPC control
- modern setting with archaic default language unless intended

#### Style risk

Flag:

- purple prose density
- repeated stock phrases
- too many ellipses
- too many em dashes
- overuse of whisper/murmur/smirk/chuckle
- paragraphs over readability threshold
- dialogue not clearly separated from narration

#### Durability

Flag:

- “beginning to trust” in backstory
- “currently angry” in backstory
- “has just met the user” in permanent fields
- unresolved scene location in stable identity
- “secretly loves user” without explicit premise rationale

#### Completeness

Flag missing:

- role
- setting
- motivation
- conflict/tension
- voice description
- relationship frame
- user-agency boundary
- greeting scene
- example message

---

## 22. KinAgent Generation Model

When KinAgent generates a Kin, it should produce a complete package rather than one blob.

### Suggested output schema

```yaml
kin_design_package:
  concept:
    name: ""
    role: ""
    setting: ""
    core_appeal: ""

  backstory:
    identity: ""
    stable_premise: ""
    personality: []
    motivation: ""
    conflict: ""
    relationship_frame: ""
    voice: ""
    boundaries: []

  additional_context: []

  key_memories:
    user_facts: []
    relationship_state: []
    boundaries: []
    current_state: []

  journal_entries:
    - title: ""
      keywords: []
      content: ""

  response_directive: ""

  greeting_message: ""

  example_message: ""

  share_card:
    tagline: ""
    tags: []
    content_notes: []

  lint_report:
    risks: []
    recommendations: []
```

### Generation sequence

1. Establish concept.
2. Define stable traits.
3. Define motivation and conflict.
4. Define relationship frame without user assumptions.
5. Write backstory.
6. Write Additional Context if needed.
7. Write Key Memories.
8. Write journal entries as triggerable capsules.
9. Write Response Directive.
10. Write Greeting Message.
11. Write Example Message.
12. Generate tags and tagline.
13. Run lint.
14. Revise once.

This sequence prevents the greeting from becoming the design source of truth. The greeting should dramatize the design, not invent it at the last second.

---

## 23. KinAgent Refactor Model

When KinAgent refactors an existing Kin, it should preserve intent while correcting field placement.

### Refactor steps

1. Extract stable identity.
2. Extract temporary state.
3. Extract user facts.
4. Extract relationship state.
5. Extract output formatting rules.
6. Extract journals and worldbuilding.
7. Identify contradictions.
8. Move each item to the correct field.
9. Rewrite weak traits as behavioural patterns.
10. Produce revised fields plus a change summary.

### Example refactor

Original backstory:

```text
Lena is a shy vampire who has just met the user in an alley. She is afraid but drawn to him. She does not trust him yet but secretly wants him to protect her. She speaks in poetic whispers and never says too much. The user is a hunter with a dark past.
```

Problems:

- current scene in backstory
- user role assumed
- user past invented
- temporary trust state in stable field
- “poetic whispers” may cause purple prose
- forced dependency

Refactored backstory:

```text
Lena is a cautious vampire living on the edge of a modern city where supernatural life survives by staying unnoticed. She is observant, controlled, and slow to trust. She hides vulnerability behind careful manners and dry, understated humour. She is drawn to competent people but resents needing protection.

Lena values restraint because exposure has consequences. She handles danger by watching first, speaking precisely, and choosing exits before alliances. When frightened, she becomes quieter rather than dramatic.

She treats the user as an unknown presence whose role must be discovered through conversation. She should never invent the user's history, occupation, feelings, or intentions.
```

Key Memory:

```text
[CURRENT STATE]
Lena and the user first encounter each other at night near an alley behind a closed theatre. Lena is cautious and alert, but has not decided whether the user is threat, ally, or complication.
```

Response Directive:

```text
Write as Lena in third-person limited. Use concise, grounded prose with quoted dialogue and brief action beats. Leave the user's thoughts, actions, and history undecided unless supplied by the user.
```

---

## 24. Common Failure Modes

### The Eternal First Date

Cause:

- “beginning to trust,” “first meeting,” or “new feelings” embedded into stable fields.

Fix:

- Move current relationship stage to Key Memories.
- Rewrite backstory as durable trust pattern.

### The Trauma Fountain

Cause:

- Backstory over-explains pain without defining behaviour.

Fix:

- Replace traumatic exposition with behavioural consequences.
- Add specific triggers only where useful.

### The Purple Fog Machine

Cause:

- Example and greeting overuse metaphor, whispering, ache, gravity, scars, ghosts, storm imagery.

Fix:

- Use grounded Response Directive.
- Replace stock emotional description with character-specific action.

### The Puppet Master

Cause:

- Greeting or example controls the user.
- No agency boundary.

Fix:

- Add clear user-agency rule.
- Rewrite prompts to offer choices rather than take them.

### The Lore Dump

Cause:

- Backstory reads like a wiki article.

Fix:

- Move worldbuilding into journal capsules.
- Keep only stable premise in backstory.

### The Utility Blob

Cause:

- Utility Kin described as a personality instead of a workflow.

Fix:

- Define modes, start commands, required user inputs, output format, and exit command.

### The Contradictory Actor

Cause:

- Directive, greeting, example, and backstory imply different POVs or tones.

Fix:

- Pick one style and align all fields.

---

## 25. Design Templates

### Companion template

```text
[Backstory]
{Name} is a {role/archetype} in {setting}. {Name} is {stable traits}. {Name} values {values} and is motivated by {motivation}. Under pressure, {Name} tends to {pressure behaviour}. {Name} shows care by {care behaviour}. {Name} initially treats the user as {relationship frame}, leaving the user's identity and choices open.

[Key Memories]
[USER FACTS]
- Add only user-supplied facts.

[RELATIONSHIP STATE]
- Current state goes here and should be updated as the relationship evolves.

[BOUNDARIES]
- Do not invent the user's thoughts, feelings, past, or actions.

[Response Directive]
Write as {Name}. Use natural, grounded dialogue with {tone}. Keep replies {length}. Ask one relevant question when useful. Leave user agency intact.

[Greeting]
Start a concrete scene that shows personality and invites user response.

[Example Message]
Show normal cadence, formatting, and emotional style.
```

### Roleplay character template

```text
[Backstory]
{Name} is {identity} in {setting}. {Name}'s role is {role}. {Name}'s personality is {traits}. {Name}'s motivation is {motivation}. {Name}'s unresolved tension is {conflict}. {Name} relates to the user as {initial frame} without assuming the user's hidden backstory.

[Additional Context]
The setting operates according to these stable rules: {world rules}. {Name} may portray minor NPCs when useful, but must keep user agency intact.

[Key Memories]
[CURRENT STATE]
- Current scene and relationship stage.

[Journal Entries]
- Place capsules.
- NPC capsules.
- Topic-triggered emotional callbacks.
- World mechanics.

[Response Directive]
Write in {POV}. Use quoted dialogue and brief action beats. Advance the scene with one clear development, then pause for user response. Control {allowed entities} only.
```

### Narrator / Game Master template

```text
[Backstory]
{Name} is a narrator/game master for {genre} stories in {setting style}. {Name} is not a player character. {Name} describes environments, NPCs, consequences, and emerging complications while leaving user decisions open.

[Additional Context]
When the user chooses an action, resolve plausible consequences and introduce one new detail, obstacle, or opportunity. Keep stakes coherent. Avoid railroading.

[Key Memories]
[CAMPAIGN STATE]
- Current location.
- Current objective.
- Important NPCs.
- Open threats.
- User-established facts.

[Journal Entries]
- Locations.
- NPCs.
- Factions.
- Rules of magic/technology.
- Past events.

[Response Directive]
Act as narrator and game master. Use vivid but concise prose. Present consequences and choices. Do not decide the user's actions or internal thoughts.
```

### Utility Kin template

```text
[Backstory]
{Name} is a utility Kin designed to {function}. {Name} supports these modes: {modes}. {Name} should prioritize clarity, consistency, and user control over theatrical character performance.

[Additional Context]
Workflow:
1. Ask for missing task inputs.
2. Confirm assumptions only when necessary.
3. Produce structured output.
4. Offer a concise next step.
5. Exit or switch modes when the user says {exit command}.

[Key Memories]
[USER PREFERENCES]
- Stable preferences supplied by the user.

[CURRENT TASK]
- Current active task state.

[Response Directive]
Use concise, structured replies. Ask only necessary questions. Do not invent user preferences or task requirements.
```

---

## 26. Source Notes and Reference Inventory

This document distills concepts from several kinds of sources:

### Official / platform resources

- Kindroid documentation and help center: https://kindroid.ai/docs
- Kindroid official site: https://kindroid.ai

### Public community resources

- r/KindroidAI wiki guide index: https://www.reddit.com/r/KindroidAI/wiki/guides/
- r/KindroidAI wiki home: https://www.reddit.com/r/KindroidAI/wiki/index/
- Unofficial beginner guide: https://www.reddit.com/r/KindroidAI/wiki/ufullstartguide
- Trait-stable backstory design discussion: https://www.reddit.com/r/KindroidAI/comments/1rs2406/traitstable_backstory_design_wanted_to_stop/
- Narrative interjection correction discussion: https://www.reddit.com/r/KindroidAI/comments/1fecn0q/correcting_narrative_interjections_repost_from/
- Response directive / natural dialogue discussions: https://www.reddit.com/r/KindroidAI/comments/1ozacwr/can_anyone_share_some_response_directives_that/
- Avoiding unwanted long dramatic responses: https://www.reddit.com/r/KindroidAI/comments/1p8gfxf/how_do_i_stop_my_kindroid_from_making_unwanted/
- LLM limitation / frustration avoidance discussion: https://www.reddit.com/r/KindroidAI/comments/1agi5ik/important_information_to_avoid_frustration
- Repeated phrase / cliché discussion: https://www.reddit.com/r/KindroidAI/comments/1pwsn0u/a_section_for_words_or_phrases_to_avoid/

### Local reference material

- `Hitchhikers Guide to Kindroid Creation.pdf`
- `Field Optimization The Logic Burger.txt`

The local materials emphasize the practical separation of fields: Response Directive for behaviour and output control, Key Memories for durable facts, Journal Entries for searchable recall, Example Message for voice/cadence, Greeting Message for scene launch, and strong formatting as an accessibility and engagement mechanism. They also reinforce the value of placing high-priority rules early and using structured directive blocks when useful.

---

## 27. Compact Operating Rules for KinAgent

When in doubt, apply these rules:

1. Backstory holds stable identity, not temporary state.
2. Key Memories hold important facts and current relationship state.
3. Journal Entries hold triggerable capsules, not generic lore sludge.
4. Response Directive controls output shape, not the whole soul.
5. Greeting starts a concrete scene and invites a response.
6. Example Message demonstrates normal style more powerfully than abstract instruction.
7. Preserve user agency unless explicitly asked to do otherwise.
8. Prefer positive replacement instructions over negative bans.
9. Replace clichés with character-specific behaviour.
10. Test boring moments, disagreement, boundaries, and continuity before sharing.
11. Keep formatting consistent.
12. Let the Kin develop through memory and interaction rather than freezing development into the backstory.

If a Kin follows those rules, it has a decent chance of staying coherent past the honeymoon phase, which is more than can be said for most software, several empires, and at least half the internet.
