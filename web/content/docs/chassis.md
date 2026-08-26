---
title: The chassis
summary: A classless character still has a body underneath. Here is what it does, and the design problem we have not solved yet.
order: 3
---

When you make a character, the client asks you to pick a class. You cannot skip that question — it
is drawn by the game client from its own files, and no server can change it.

On Ashmorrow we call the answer your **chassis**, because that is what it has been reduced to: the
frame your character is built on, not the list of things you may do.

## What the chassis decides

- **Base stats and how they scale.** How much attack power you get per point of Strength, how much
  spell power per point of Intellect, how much mana per point of Spirit.
- **Health and armour.** A Warrior chassis carries more of both than a Mage chassis, at every level.
- **Your resource.** Rage, mana, energy, runic power.
- **Armour proficiency.** Which armour class you can wear without penalty.

## What the chassis does not decide

What you can learn. That is the entire point of the realm.

A Mage chassis that has spent its budget on Sword Mastery genuinely swings the sword, with the same
ability the "real" warriors use. It will hit for less, because it has a Mage's attack power scaling
and a Mage's health to survive getting close enough to use it.

Which brings us to the honest part.

## The problem we have not solved

**Balance will be dominated by the chassis long before the ability pool matters.**

That Mage-with-a-sword is not a fun off-meta build; it is a strictly worse warrior. The abilities are
free, but the scaling behind them is not, and the scaling comes from a hidden class that the player
was asked to choose before they understood any of this.

There are three ways out, and none of them is free:

1. **One chassis for everyone.** Normalise every class's stat tables to a single neutral profile.
   The cleanest result — build choice becomes the only thing that differentiates characters — and
   the largest amount of work. It also erases class flavour entirely.
2. **The chassis as an honest choice.** Keep the frames distinct and *tell* players what each one is
   for, so "tough" and "fragile" become a real decision made with real information. Least work,
   keeps variety, and accepts that some chassis-and-ability combinations will be better than others.
3. **Correct it at runtime.** Apply a hidden aura that normalises stats as you play. Flexible and
   reversible, and it spends the rest of its life fighting the game's own scaling code.

This is a design decision, not an engineering one, and it is the single biggest open question on the
project. It will be settled before the skill-point system ships, because it decides what that system
is balancing.

Until then, the armory shows your chassis plainly on every character page rather than hiding it. If
it is going to shape your character this much, you should be able to see it.
