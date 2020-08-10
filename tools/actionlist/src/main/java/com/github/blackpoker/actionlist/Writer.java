package com.github.blackpoker.actionlist;

import java.io.IOException;
import java.util.Map;

public interface Writer {
	void write(Map<String, Object> map, String outPath,String templateName) throws IOException ;
}
