package com.github.blackpoker.actionlist.writer;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Properties;

import org.apache.velocity.Template;
import org.apache.velocity.VelocityContext;
import org.apache.velocity.app.Velocity;
import org.apache.velocity.exception.MethodInvocationException;
import org.apache.velocity.exception.ParseErrorException;
import org.apache.velocity.exception.ResourceNotFoundException;

import com.github.blackpoker.actionlist.TexFn;
import com.github.blackpoker.actionlist.Writer;
import com.github.blackpoker.actionlist.velocity.MyRefrenceInsertionEventHandler;

public class TexWriter implements Writer {

	public void write(Map<String, Object> map, String outPath, String templateName) throws IOException {

		System.out.println("TeX OUTPUT");
		
		try {
			// Velocityの初期化
			Properties p = new Properties();
		    // class path 配下のvmファイルを参照する設定です。
		    // よくあるWebアプリだとresourcesフォルダ配下のvmは、「XXX.vm」とだけ記述すれば読込んでくれます。
		    p.setProperty("resource.loader", "class");  
		    p.setProperty("class.resource.loader.class",
		            "org.apache.velocity.runtime.resource.loader.ClasspathResourceLoader");  
		    p.setProperty("input.encoding", "UTF-8");
	        //p.put("eventhandler.referenceinsertion.class", MyRefrenceInsertionEventHandler.class.getName());
		    
			Velocity.init(p);
			// Velocityコンテキストに値を設定
			VelocityContext context = new VelocityContext();
			
			for (Entry<String, Object> entry : map.entrySet()) {
				// context.setVariable("list", listMap);
				context.put(entry.getKey(), entry.getValue());
			}
			// TexFnを設定
			context.put("texFn",new TexFn());

			StringWriter sw = new StringWriter();
			// テンプレートの作成
			Template template = Velocity.getTemplate(templateName+".tex", "UTF-8");
			// テンプレートとマージ
			template.merge(context, sw);
			// マージしたデータはWriterオブジェクトであるswが持っているのでそれを文字列として出力
			
			// ファイルに書き込み
			File f = new File(outPath);
			FileWriter fileWriter = new FileWriter(f);
			fileWriter.write(sw.toString());
			fileWriter.close();
			
//			System.out.println(sw.toString());
			sw.flush();

			// エラー処理
		} catch (ResourceNotFoundException e) {
			// テンプレートが見つからないときの処理
			throw new IOException(e);
		} catch (ParseErrorException e) {
			// 構文にエラーがあるときの処理
			throw new IOException(e);
		} catch (MethodInvocationException e) {
			// テンプレートのどこかにエラーがあるときの処理
			throw new IOException(e);
		} catch (Exception e) {
			// その他のエラー時の処理
			throw new IOException(e);
		}
		
		System.out.println("TeX OUTPUT END");
//
//		ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
//		resolver.setTemplateMode(TemplateMode.HTML);
//		resolver.setSuffix(".html");
//		TemplateEngine templateEngine = new TemplateEngine();
//		templateEngine.setTemplateResolver(resolver);
//		templateEngine.addDialect(new CustomDialect());
//
//		StringWriter writer = new StringWriter();
//		Context context = new Context();
//
//		for (Entry<String, Object> entry : map.entrySet()) {
//			// context.setVariable("list", listMap);
//			context.setVariable(entry.getKey(), entry.getValue());
//		}
//
//		templateEngine.process(templateName, context, writer);



		// System.out.println(writer.toString());

	}

}
