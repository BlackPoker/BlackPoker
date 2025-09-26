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
import com.github.blackpoker.actionlist.StrFn;
import com.github.blackpoker.actionlist.Writer;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

        // 追加: actList, charList, fogList, trumpList に含まれる type 値を集めて
        // 重複除去・ソートしたリストを groupTypes としてテンプレートに渡す
        List<String> groupTypes = collectGroupTypes(map);
        context.setVariable("groupTypes", groupTypes);

        // templateName が "std" なら templates/std.html を探す
        templateEngine.process(templateName, context, writer);

        // 出力先ファイルに書き込み
        File f = new File(outPath);
        try (FileWriter fileWriter = new FileWriter(f)) {
            fileWriter.write(writer.toString());
        }
    }

    /**
     * map の中の actList/charList/fogList/trumpList を走査し、各要素の "type" を
     * 集めて重複を取り除き、日本語ロケールでソートしたリストを返す。
     */
    private List<String> collectGroupTypes(Map<String, Object> map) {
        Set<String> set = new HashSet<>();
        String[] keys = { "actList", "charList", "fogList", "trumpList" };
        for (String k : keys) {
            Object obj = map.get(k);
            if (obj instanceof Collection<?>) {
                Collection<?> col = (Collection<?>) obj;
                for (Object item : col) {
                    if (item instanceof Map<?, ?>) {
                        Map<?, ?> rawMap = (Map<?, ?>) item;
                        Object t = rawMap.get("type");
                        if (t != null) {
                            String s = String.valueOf(t).trim();
                            if (!s.isEmpty())
                                set.add(s);
                        }
                    }
                }
            }
        }

        List<String> list = new ArrayList<>(set);
        // 日本語ロケールでソート
        Collator collator = Collator.getInstance(Locale.JAPANESE);
        Collections.sort(list, collator);
        return list;
    }
}
