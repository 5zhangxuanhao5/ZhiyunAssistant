# 图标审美修订

琥珀胶片的应用图标位于 web/theme-film.png。本次使用内置 imagegen 工具生成并迭代，透明外缘；未使用 API/CLI，也未使用校园账号或私人课程图像。项目保存最终选定版本。

最终修改提示词：

> Refine this production macOS app icon. Preserve the clever open-book / curling-film-strip motif, amber and ivory palette, small orange bookmark, single rounded-square silhouette and centered composition. Make it more contemporary and quietly creative: matte glazed amber and soft cream paper, much subtler highlights, no shiny gold metal, no gold rim, no luminous halo. Simplify to fewer larger paper layers and cleaner film perforations so the icon reads beautifully at small Dock sizes. The current rendering has stray red/orange pixels outside the rounded square: completely remove every detached pixel and exterior halo. The entire area outside the clean rounded-square silhouette must be truly transparent alpha=0, with 9 percent clear transparent canvas margins. No background panel, no cast shadow extending outside the silhouette. No text, no play triangle. Keep the concept, improve material restraint and finish.

图标和首页使用课堂笔记与胶片的共同意象，取消旧播放器占位符和风景框。其余 19 套逐项检查构图、图标和色彩；包豪斯侧栏使用继承的浅色操作图标，避免低对比红蓝叠加。日期、收藏、导航、课件翻页及笔记工具使用 theme-icons.js 的语义矢量体系。

设置图标采用中心对称的八齿轮廓，密钥采用同一 24×24 坐标系。20 套主题的所有语义图标由实际 SVG getBBox 加半线宽检查绘制边界；不依赖 overflow 截断来隐藏错误路径。
