package com.github.blackpoker.actionlist;

import java.util.HashSet;
import java.util.Set;

import org.thymeleaf.context.IExpressionContext;
import org.thymeleaf.dialect.IExpressionObjectDialect;
import org.thymeleaf.expression.IExpressionObjectFactory;

public class CustomDialect implements IExpressionObjectDialect {

	final static String KEY = "sfn";
	final Set<String> names = new HashSet<String>() {
		{
			add(KEY);
		}
	};
	@Override
	public String getName() {
		return "FunctionDialect";
	}
	@Override
	public IExpressionObjectFactory getExpressionObjectFactory() {
		return new IExpressionObjectFactory() {
			
			@Override
			public boolean isCacheable(String expressionObjectName) {
				return true;
			}
			
			@Override
			public Set<String> getAllExpressionObjectNames() {
				return names;
			}
			
			@Override
			public Object buildObject(IExpressionContext context, String expressionObjectName) {
				if(KEY.equals(expressionObjectName)){
					return new StrFn();
				}
				return null;
			}
		};
	}
}
