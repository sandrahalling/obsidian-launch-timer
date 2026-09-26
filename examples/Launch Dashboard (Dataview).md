# Launch Dashboard

Needs Dataview. Plain DQL, no JavaScript queries.

The counter math goes through milliseconds, because Dataview splits a date difference into months + days and `.days` alone would be wrong past a month. The number still drives the sort. The T column hands the date to the Launch Timer plugin, which draws the dots; without the plugin it shows the raw date.

## Open tasks, furthest past the window first

```dataview
TABLE WITHOUT ID
  "[t0:: " + dateformat(task.t0, "yyyy-MM-dd") + "]" AS "T",
  regexreplace(regexreplace(task.text, " *.(t0|completion):: *[0-9-]+.", ""), " *#[^ ]+", "") AS "Task",
  join(task.tags, " ") AS "Tags",
  file.link AS "Where"
FLATTEN file.tasks AS task
FLATTEN round((number(dateformat(date(today), "x")) - number(dateformat(task.t0, "x"))) / 86400000) AS clock
WHERE task.t0 AND !task.completed
SORT clock DESC
```

## Grouped by tag (checkable, with badges)

```dataview
TASK
FLATTEN tags AS tag
WHERE t0 AND !completed
GROUP BY tag
SORT t0 ASC
```

## Grouped by note

```dataview
TASK
WHERE t0 AND !completed
GROUP BY file.link
SORT t0 ASC
```

## Done — where on the clock each one landed

```dataview
TABLE WITHOUT ID
  "✓ " + choice(landed > 0, "T+" + landed, "T" + landed) AS "Landed",
  regexreplace(regexreplace(task.text, " *.(t0|completion):: *[0-9-]+.", ""), " *#[^ ]+", "") AS "Task",
  task.completion AS "Done",
  file.link AS "Where"
FLATTEN file.tasks AS task
FLATTEN round((number(dateformat(task.completion, "x")) - number(dateformat(task.t0, "x"))) / 86400000) AS landed
WHERE task.t0 AND task.completed AND task.completion
SORT task.completion DESC
```

## Notes with a window

Front matter only. Dataview also rolls task-line fields up to the page, which would pull in every meeting note.

```dataview
TABLE WITHOUT ID
  "[t0:: " + dateformat(date(file.frontmatter.t0), "yyyy-MM-dd") + "]" AS "T",
  file.link AS "Note",
  file.frontmatter.t0 AS "T-zero"
FROM ""
WHERE file.frontmatter.t0
FLATTEN round((number(dateformat(date(today), "x")) - number(dateformat(date(file.frontmatter.t0), "x"))) / 86400000) AS clock
SORT clock DESC
```
