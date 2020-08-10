package com.github.blackpoker.actionlist;

import java.io.IOException;
import java.io.InputStreamReader;
import java.util.Properties;

public enum PropertyHolder {

	ReplaceConf("replace.conf"),
	ReplaceTexConf("replace-tex.conf");
	
	private String resourcePath;
	private Properties properties;
	
	private PropertyHolder(String resourcePath){
		this.resourcePath = resourcePath;
		Properties properties = new Properties();
		
		try {
			properties.load(new InputStreamReader(this.getClass().getClassLoader().getResourceAsStream(resourcePath),"UTF-8"));
		} catch (IOException e) {
			e.printStackTrace();
			throw new IllegalArgumentException("fail file read:"+resourcePath);
		}
		this.properties = properties;
	}
	
	public Properties getProperties(){
		return this.properties;
	}
}
