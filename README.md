# courses-aalto-better-filters

<img src="preview.gif" alt="Preview GIF displaying the extension in use" />

[courses.aalto.fi](https://courses.aalto.fi/s/course/hed__Course__c/Default?language=en_US)
has garbage-tier UX. This is a hack to try and improve specifically the
filtration of the courses.

### Features

- _Filtering courses by the prefix of the course code._ Roughly speaking, this
  means filtering by which school department is responsible for the course.

- _Filtering by period._ Filter by which period the course starts in.

- _Positive & negative filters_. Positive filters display only courses matching
  the selected filter. Negative filters display courses that **don't** match the
  filter. Positives override negatives so negatives will only work if only
  negative filters of a certain filter type are selected.

### Running locally

Get familiarized with [the WebExtensions docs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions).

The package is configured to use [Bun](https://bun.sh), but you should be able
to easily modify it to use your preferred package manager.

```
bun i
bun run build
bun run client
```

`bun run client` uses
[web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
with Firefox developer edition. You can also run the extension in different ways as shown in [this
guide](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Your_first_WebExtension).
