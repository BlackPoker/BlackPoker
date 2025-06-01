package com.github.blackpoker.actionlist.writer;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.util.Map;
import java.util.Map.Entry;

import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

import com.github.blackpoker.actionlist.CustomDialect;
import com.github.blackpoker.actionlist.Writer;

public class HtmlWriter implements Writer {

    @Override
    public void write(Map<String, Object> map, String outPath, String templateName) throws IOException {
        // テンプレートリゾルバ設定
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setSuffix(".html");        
        resolver.setCharacterEncoding("UTF-8");
        resolver.setCacheable(false);

        TemplateEngine templateEngine = new TemplateEngine();
        templateEngine.setTemplateResolver(resolver);
        templateEngine.addDialect(new CustomDialect());

        StringWriter writer = new StringWriter();
        Context context = new Context();

        // ビューモデルをコンテキストにセット
        for (Entry<String, Object> entry : map.entrySet()) {
            context.setVariable(entry.getKey(), entry.getValue());
        }

        // templateName が "std" なら templates/std.html を探す
        templateEngine.process(templateName, context, writer);

        // 出力先ファイルに書き込み
        File f = new File(outPath);
        try (FileWriter fileWriter = new FileWriter(f)) {
            fileWriter.write(writer.toString());
        }
    }
}
