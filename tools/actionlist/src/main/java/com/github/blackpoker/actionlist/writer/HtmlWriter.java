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

public class HtmlWriter implements Writer{


	public void write(Map<String, Object> map, String outPath,String templateName) throws IOException {

		ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
		resolver.setTemplateMode(TemplateMode.HTML);
		resolver.setSuffix(".html");
		TemplateEngine templateEngine = new TemplateEngine();
		templateEngine.setTemplateResolver(resolver);
		templateEngine.addDialect(new CustomDialect());

		StringWriter writer = new StringWriter();
		Context context = new Context();

		for (Entry<String, Object> entry : map.entrySet()) {
			// context.setVariable("list", listMap);
			context.setVariable(entry.getKey(), entry.getValue());
		}

		templateEngine.process(templateName, context, writer);

		// ファイルに書き込み
		File f = new File(outPath);
		FileWriter fileWriter = new FileWriter(f);
		fileWriter.write(writer.toString());
		fileWriter.close();

		// System.out.println(writer.toString());

	}

}
