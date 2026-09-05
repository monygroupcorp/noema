# Train a model on your own work

**Published:** 2026-09-05

A walkthrough from a folder of references to a model you can run, and what each step actually costs you.

Training here is not a separate product with its own vocabulary. A training is a run, like every
other run: it takes inputs, it takes a while, it costs credits, and you watch it on the same kind of
screen you watch a generation on. What makes it worth its own guide is the part before the run —
the material you feed it.

One dataset can produce many models. It is worth building the dataset well.

## 1. Put the material somewhere

Start at [Datasets](/datasets) and make a set. Add images by uploading them; the set is yours and
stays in your library between sessions.

Each set carries a **custody** marking, shown as a hemisphere on the card. Custody says where work
on this set is allowed to run. It matters more here than almost anywhere else in the product,
because the next step involves a model reading every one of your images.

A set's readiness line names the next thing it needs. Follow it rather than guessing.

## 2. Caption the images

A model learns from your images *and* from what you say about them. Open a set from
[Datasets](/datasets) and start a caption pass.

Captioning is a real run on real compute — you fire it and watch it fill. It acquires a machine,
prepares it, then reads your images one at a time, so the screen shows the stages and a per-image
count rather than a spinner and a status word. Expect the first minutes to produce nothing at all;
that is the machine being got, not a stall.

Two things about caption passes that are not obvious:

- **Every caption is editable in place.** The pass gives you a draft to correct, not a verdict. The
  corrections are the point — this is where you teach the model what to notice.
- **A pass extends the captionset it was given.** Adding two images to a set of thirty and running
  a pass captions the two, not the thirty. If you want a whole set captioned afresh — by a different
  captioner, say — mint a new captionset explicitly. That control is opt-in precisely so a re-run
  never quietly overwrites work you edited by hand.

You can also mint an empty captionset and write every caption yourself. That is the same road with
the compute step removed.

## 3. Set up the training

From the set, go to **derive**. This is the recipe, and it is four choices:

- **Which captionset.** This is the lesson. A set can carry several; you pick the one the model
  learns from.
- **Base model.** What you are training on top of. The picker lists the bases the trainer currently
  accepts — read it there rather than from any list written down elsewhere, including this one,
  because the catalogue moves.
- **Trigger word.** The word that summons what you trained, once the model is on your shelf.
- **Steps.** How long to train. A fresh form starts at 1000.

The trainer has its own auto-captioner, and on this screen it is switched **off** by construction.
The whole point of the previous step is that you chose which captions the model learns from; letting
the trainer caption over them would erase that choice.

Your base model, trigger and step count are remembered for next time. The captionset is not — which
set is the right one is a question about this dataset today, not a preference.

Then begin the training.

## 4. Watch it learn

You land on the run monitor with that training's id. It polls the run and shows what the run itself
reports: status, when it started, how long it has been going, what it cost, and its outputs when it
finishes.

It does not show a loss curve or checkpoint previews. Those are not part of what a run reports, so
there are no panels pretending to them. A monitor that is half-real looks exactly like a real one at
a glance, which is worse than one that shows only what it can see.

If no machine was free, the screen says so and the training is **scheduled** rather than failed:
attempts retry hourly until the window closes. An attempt that never started is not charged. You can
close the tab — the finished model lands on your shelf either way.

## 5. Use it

Trained models appear on your [shelf](/models), alongside anything you have imported, with the
provenance the platform actually knows: base model, trigger word, license, listing state.

Listing a model publicly also makes it royalty-eligible, and that part is real: when somebody else's
run uses your model, a share of what that run spends is split across the model's rights holders when
the run completes. What does not exist yet is anywhere to read it. Nothing returns what you have
earned, so the shelf shows no earnings — not because nothing accrues, but because there is nothing
to fetch. Until that lands, a listed model earns quietly.

From there the model is a model. It runs from the catalogue, it runs from the canvas, and it runs
over the API — see [composing a workflow](/blog/compose-a-workflow) and
[running noema over the API](/blog/run-noema-over-the-api).
