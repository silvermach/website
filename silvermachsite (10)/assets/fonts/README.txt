SUPPLIED WEB FONTS — IN USE, NOTHING TO DO.

    BauhausStd-Medium.woff2   titles and headings   (--font-display)
    BauhausStd-Light.woff2    body and UI text      (--font-body)

Both files were supplied for this project and are loaded directly by
../../css/fonts.css. They are used byte-for-byte as provided: nothing was
converted, subsetted, renamed internally, regenerated or substituted.

Only these two cuts exist, so each @font-face is declared across the full
100-900 weight range. Headings that the stylesheet already sets to 600/700/800
therefore render from BauhausStd-Medium with the browser's synthetic
emboldening rather than from a separate bold file. No weight, size, spacing or
line-height in the project was changed to accommodate this.
